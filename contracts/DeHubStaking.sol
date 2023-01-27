// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "hardhat/console.sol";
import {DeHubUpgradeable, IERC20Upgradeable, SafeMathUpgradeable, SafeERC20Upgradeable} from "./abstracts/DeHubUpgradeable.sol";
import {IDeHubStaking} from "./interfaces/IDeHubStaking.sol";

contract DeHubStaking is DeHubUpgradeable, IDeHubStaking {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  IERC20Upgradeable public dehubToken;
  IERC20Upgradeable public rewardToken;
  
  struct Pool {
    /**
     * @notice Start timestamp of Staking contract
     *
     */
    uint256 stakingStartAt;
    /**
     * @notice Fixed reward period, after every reward period, users can claim
     * their accumulated rewards
     */
    uint256 rewardPeriod;
    /**
     * @notice Every time owner funds reward, increase reward index and
     * stakers can get rewards after reward period
     */
    uint256 lastRewardIndex;
    /**
     * @notice If users unstake earlier than the term, they will face % of fee.
     * 100% in 10000
     */
    uint256 forceUnstakeFee;
    /**
     * @notice Tier periods in second, staked tokens will be locked
     * according to this period
     */
    uint256[] tierPeriods;
    /**
     * @notice Every tier has different percent charging of rewards, 100% in 10000
     * i.e. Tier 1 = 25% of total reward, Tier 2 = 25%, Tier 3 = 50%
     * The length of tierPeriods and tierPercents should be same
     */
    uint256[] tierPercents;
  }

  Pool public pool;

  uint256 public constant shareMultiplier = 10000;

  // <Reward Index, <Tier Index, <Account, StakingShare>>>
  mapping(uint256 => mapping(uint256 => mapping(address => uint256)))
    public stakingShares;
  // <Reward Index, <Tier Index, Total Share>>
  mapping(uint256 => mapping(uint256 => uint256)) public totalSharesOnTiers;
  mapping(uint256 => Reward) public rewards;
  mapping(address => UserInfo) public userInfos;

  uint256 public totalStaked;
  uint256 public totalStakers;

  /* -------------------------------------------------------------------------- */
  /*                                  Modifiers                                 */
  /* -------------------------------------------------------------------------- */

  /* -------------------------------------------------------------------------- */
  /*                             External Functions                             */
  /* -------------------------------------------------------------------------- */

  function __DeHubStaking_init(
    IERC20Upgradeable dehubToken_,
    IERC20Upgradeable rewardToken_,
    uint256 rewardPeriod_,
    uint256 forceUnstakeFee_,
    uint256[] memory tierPeriods_,
    uint256[] memory tierPercents_
  ) public initializer {
    DeHubUpgradeable.initialize();

    dehubToken = dehubToken_;
    rewardToken = rewardToken_;
    pool.rewardPeriod = rewardPeriod_;
    pool.forceUnstakeFee = forceUnstakeFee_;
    pool.tierPeriods = tierPeriods_;
    pool.tierPercents = tierPercents_;

    pool.stakingStartAt = block.timestamp;
  }

  function setRewardPeriod(uint256 rewardPeriod_) external onlyOwner {
    require(rewardPeriod_ != 0, "Zero input period");
    pool.rewardPeriod = rewardPeriod_;
    emit RewardPeriod(rewardPeriod_);
  }

  function setForceUnstakeFee(uint256 forceUnstakeFee_) external onlyOwner {
    pool.forceUnstakeFee = forceUnstakeFee_;
    emit ForceUnstakeFee(pool.forceUnstakeFee);
  }

  function setTierPeriods(
    uint256[] calldata tierPeriods_,
    uint256[] calldata tierPercents_
  ) external onlyOwner {
    require(tierPeriods_.length == tierPercents_.length, "Not match tiers length");
    pool.tierPeriods = tierPeriods_;
    pool.tierPercents = tierPercents_;
    emit TierPeriods(tierPeriods_, tierPercents_);
  }

  /**
   * @dev Function to trigger stopped state
   */
  function pause() external whenNotPaused onlyOwner {
    _pause();
  }

  /**
   * @dev Function to trigger normal state
   */
  function unpause() external whenPaused onlyOwner {
    _unpause();
  }

  /**
   * @notice Stake $DHB token on a tier and staked token will be locked
   * for a while. Users can stake anytime on different tier multiple times.
   * All the staked amounts will be accumulated individually according to tier
   * and will be used in calculating shares.
   * If user staked multiple times, the longest time will be unlock time.
   */
  function stake(uint256 period, uint256 amount) external whenNotPaused {
    require(period > 0, "Zero input period");
    require(amount > 0, "Zero input amount");

    UserInfo storage userInfo = userInfos[msg.sender];

    // Staking tier index
    uint256 tierIndex = _getTierIndex(period);
    // End reward period index which involves locked amount
    uint256 endLockedRewardIndex = userInfo.unlockAt > 0
      ? _getRewardIndex(userInfo.unlockAt - 1)
      : 0;
    // Current reward period index
    uint256 startRewardIndex = _getRewardIndex(block.timestamp);

    // Stakers can't stake in the past reward period
    require(startRewardIndex >= pool.lastRewardIndex, "Not allowed to stake in past reward period");

    // In the locked period, stakers can't change tier
    if (
      userInfo.totalAmount > 0 &&
      endLockedRewardIndex >= startRewardIndex &&
      tierIndex != userInfo.lastTierIndex
    ) {
      revert("Different tier index with previous one");
    }

    // Update total claimable amoount
    _updatePool(userInfo);

    _stake(userInfo, tierIndex, period, amount, block.timestamp);

    dehubToken.safeTransferFrom(msg.sender, address(this), amount);

    emit Staked(msg.sender, period, amount, block.timestamp);
  }

  /**
   * @notice Restake $DHB token n-times. If restakeCount is 0 or 1, manually restake. If more than 1, automatically restake.
   * Restaking means unstake all the staked amount and stake with new period
   * n-times. If new period is a different tier with previous staked, then the
   * contract will stake in the next reward period.
   */
  function restake(
    uint256 period,
    uint256 restakeCount
  ) external whenNotPaused {
    require(period > 0, "Zero input period");

    UserInfo storage userInfo = userInfos[msg.sender];

    uint256 rewardIndex = _getRewardIndex(block.timestamp);
    uint256 tierIndex = _getTierIndex(period);
    uint256 newAmount = 0;
    if (userInfo.unlockAt > block.timestamp) {
      // unstake earlier
      newAmount = _forceUnstake(userInfo, userInfo.totalAmount);
    } else {
      newAmount = _unstake(userInfo, userInfo.totalAmount, 0, block.timestamp);
    }

    uint256 nextStakeAt = tierIndex != userInfo.lastTierIndex // If restake with different tier, staking starts at next reward period
      ? _getRewardStartAt(rewardIndex + 1)
      : block.timestamp;

    _stake(userInfo, tierIndex, period * restakeCount, newAmount, nextStakeAt);
    emit Staked(msg.sender, period, newAmount, nextStakeAt);
  }
  
  function restakePortion(uint256 amount, uint256 period, uint256 restakeCount) external whenNotPaused {
    require(period > 0, "Zero input period");

    UserInfo storage userInfo = userInfos[msg.sender];

    uint256 rewardIndex = _getRewardIndex(block.timestamp);
    uint256 tierIndex = _getTierIndex(period);
    uint256 newAmount = 0;
    if (userInfo.unlockAt > block.timestamp) {
      // unstake earlier
      newAmount = _forceUnstake(userInfo, userInfo.totalAmount);
    } else {
      newAmount = _unstake(userInfo, userInfo.totalAmount, 0, block.timestamp);
    }
    require(amount <= newAmount, "Too much input amount to restake");

    uint256 nextStakeAt = tierIndex != userInfo.lastTierIndex // If restake with different tier, staking starts at next reward period
      ? _getRewardStartAt(rewardIndex + 1)
      : block.timestamp;

    _stake(userInfo, tierIndex, period * restakeCount, amount, nextStakeAt);
    if (amount < newAmount) {
      dehubToken.safeTransfer(msg.sender, newAmount - amount);
      emit RemainingTransfered(msg.sender, newAmount - amount);
    }
    emit Staked(msg.sender, period, amount, nextStakeAt);
  }

  /**
   * @notice Unstake unlocked tokens, even if user staked on different tiers,
   * unstake from tier 0 to last tier.
   */
  function unstake(uint256 amount) external whenNotPaused {
    UserInfo storage userInfo = userInfos[msg.sender];

    require(userInfo.totalAmount >= amount, "Invalid unstake amount");

    _updatePool(userInfo);

    uint256 newAmount = 0;
    if (userInfo.unlockAt > block.timestamp) {
      // unstake earlier
      newAmount = _forceUnstake(userInfo, amount);
    } else {
      newAmount = _unstake(userInfo, amount, 0, block.timestamp);
    }

    dehubToken.safeTransfer(msg.sender, newAmount);

    emit Unstaked(msg.sender, amount, newAmount, block.timestamp);
  }

  /**
   * @notice Claim harvest at once, harvest is calculated at the time when owner
   * funds reward
   */
  function claim() external whenNotPaused {
    UserInfo storage userInfo = userInfos[msg.sender];

    uint256 claimable = pendingHarvest(msg.sender);
    require(claimable > 0, "Nothing to harvest");
    require(rewardToken.balanceOf(address(this)) >= claimable, "Not enough rewards");

    _updatePool(userInfo);

    userInfo.harvestClaimed += claimable;
    rewardToken.safeTransfer(msg.sender, claimable);

    emit Claimed(msg.sender, claimable);
  }

  /**
   * @notice Fund rewards to this contract
   */
  function fund(uint256 amount) external onlyOwner whenNotPaused {
    uint256 rewardIndex = _getRewardIndex(block.timestamp);
    rewards[rewardIndex] = Reward({fundedAt: block.timestamp, amount: amount});
    pool.lastRewardIndex = rewardIndex + 1;

    rewardToken.safeTransferFrom(msg.sender, address(this), amount);

    emit FundedReward(rewardIndex + 1, amount);
  }

  /* -------------------------------------------------------------------------- */
  /*                             Internal Functions                             */
  /* -------------------------------------------------------------------------- */

  function _getTierIndex(uint256 period) internal view returns (uint256) {
    uint256 length = pool.tierPeriods.length;
    for (uint256 i = length - 1; i > 0; --i) {
      if (period >= pool.tierPeriods[i]) {
        return i;
      }
    }
    return 0;
  }

  function _getRewardIndex(uint256 at) internal view returns (uint256) {
    if (at <= pool.stakingStartAt) {
      return 0;
    }
    return (at - pool.stakingStartAt) / pool.rewardPeriod;
  }

  function _getRewardStartAt(
    uint256 rewardIndex
  ) internal view returns (uint256) {
    return pool.stakingStartAt + rewardIndex * pool.rewardPeriod;
  }

  function _getRewardEndAt(
    uint256 rewardIndex
  ) internal view returns (uint256) {
    return pool.stakingStartAt + (rewardIndex + 1) * pool.rewardPeriod;
  }

  function _updatePool(UserInfo storage userInfo) internal {
    // If stake/unstake on the new reward period, then calculate reward
    if (userInfo.lastRewardIndex < pool.lastRewardIndex) {
      uint256 tierCount = pool.tierPeriods.length;
      for (
        uint256 rewardIndex = userInfo.lastRewardIndex;
        rewardIndex < pool.lastRewardIndex;
        ++rewardIndex
      ) {
        for (uint256 tierIndex = 0; tierIndex < tierCount; ++tierIndex) {
          // Calculate rewards amount and accumulate from last updated index to the latest index
          userInfo.harvestTotal += _calculateReward(
            rewardIndex,
            tierIndex,
            msg.sender
          );
        }
      }
      userInfo.lastRewardIndex = pool.lastRewardIndex;
    }
  }

  function _stake(
    UserInfo storage userInfo,
    uint256 tierIndex,
    uint256 period,
    uint256 amount,
    uint256 stakeAt
  ) internal returns (uint256) {
    // New unlock timestamp
    uint256 unlockAt = stakeAt + period;
    // Current reward period index
    uint256 startRewardIndex = _getRewardIndex(stakeAt);
    // End reward period index
    uint256 endRewardIndex = _getRewardIndex(unlockAt);
    uint256 startAt;
    uint256 endAt;
    uint256 stakingShare;

    totalStaked += amount;
    if (userInfo.totalAmount == 0) {
      totalStakers++;
    }

    userInfo.lastTierIndex = tierIndex;
    // Accumulate total staked amount
    userInfo.totalAmount += amount;
    userInfo.unlockAt = unlockAt;

    for (
      uint256 rewardIndex = startRewardIndex;
      rewardIndex <= endRewardIndex;
      ++rewardIndex
    ) {
      startAt = rewardIndex == startRewardIndex
        ? stakeAt
        : _getRewardStartAt(rewardIndex);
      endAt = rewardIndex == endRewardIndex
        ? unlockAt
        : _getRewardEndAt(rewardIndex);

      stakingShare = (amount * ((endAt - startAt) * shareMultiplier)) / period;

      stakingShares[rewardIndex][tierIndex][msg.sender] += stakingShare;
      totalSharesOnTiers[rewardIndex][tierIndex] += stakingShare;
    }

    return unlockAt;
  }

  function _unstake(
    UserInfo storage userInfo,
    uint256 amount,
    uint256 unstakeFee,
    uint256 unstakeAt
  ) internal returns (uint256) {
    // Decrease total amount
    userInfo.totalAmount -= amount;
    totalStaked -= amount;

    if (userInfo.totalAmount == 0) {
      totalStakers--;
    }

    uint256 tierIndex = userInfo.lastTierIndex;
    uint256 endRewardIndex = _getRewardIndex(unstakeAt);

    // Decrease all staking share of amount from the last reward period
    uint256 amountOnShare = amount * shareMultiplier;
    uint256 rewardIndex = endRewardIndex;
    uint256 stakingShare;
    // Should unstake only in the current or future reward period
    // And should not change shares in the past reward periods already funded
    while (amountOnShare > 0 && rewardIndex >= pool.lastRewardIndex) {
      if (stakingShares[rewardIndex][tierIndex][msg.sender] >= amountOnShare) {
        stakingShares[rewardIndex][tierIndex][msg.sender] -= amountOnShare;
        totalSharesOnTiers[rewardIndex][tierIndex] -= amountOnShare;
        amountOnShare = 0;
      } else {
        stakingShare = stakingShares[rewardIndex][tierIndex][msg.sender];
        amountOnShare -= stakingShare;
        totalSharesOnTiers[rewardIndex][tierIndex] -= stakingShare;
        stakingShares[rewardIndex][tierIndex][msg.sender] = 0;
      }

      if (rewardIndex == 0) {
        break;
      }
      --rewardIndex;
    }

    uint256 newAmount = (amount * (10000 - unstakeFee)) / 10000;
    return newAmount;
  }

  function _forceUnstake(
    UserInfo storage userInfo,
    uint256 amount
  ) internal returns (uint256) {
    return _unstake(userInfo, amount, pool.forceUnstakeFee, userInfo.unlockAt);
  }

  function _calculateReward(
    uint256 rewardIndex,
    uint256 tierIndex,
    address account
  ) internal view returns (uint256) {
    if (rewardIndex >= pool.lastRewardIndex) {
      return 0;
    }

    uint256 totalShareOnTier = totalSharesOnTiers[rewardIndex][tierIndex];
    if (totalShareOnTier == 0) {
      return 0;
    }

    uint256 rewardsAmount = (rewards[rewardIndex].amount *
      pool.tierPercents[tierIndex] *
      stakingShares[rewardIndex][tierIndex][account]) /
      totalShareOnTier /
      10000;
    return rewardsAmount;
  }

  /* -------------------------------------------------------------------------- */
  /*                               View Functions                               */
  /* -------------------------------------------------------------------------- */

  function getPoolInfo() external view returns (Pool memory) {
    return pool;
  }

  function getTierIndex(uint256 period) external view returns (uint256) {
    return _getTierIndex(period);
  }

  function getRewardIndex(uint256 at) external view returns (uint256) {
    return _getRewardIndex(at);
  }

  function getRewardStartAt(
    uint256 rewardIndex
  ) external view returns (uint256) {
    return _getRewardStartAt(rewardIndex);
  }

  function getRewardEndAt(uint256 rewardIndex) external view returns (uint256) {
    return _getRewardEndAt(rewardIndex);
  }

  /**
   * @notice Get total staked amount
   */
  function userTotalStakedAmount(
    address account
  ) external view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    return userInfo.totalAmount;
  }

  /**
   * @notice Unlock timestamp
   */
  function userUnlockAt(address account) external view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    return userInfo.unlockAt;
  }

  /**
   * @notice Last tier index that user staked on
   */
  function userTierIndex(address account) external view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    return userInfo.lastTierIndex;
  }

  function userStakingShares(address account) external view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    uint256 rewardIndex = _getRewardIndex(block.timestamp);
    return stakingShares[rewardIndex][userInfo.lastTierIndex][account];
  }

  function totalShares() external view returns (uint256 [] memory) {
    uint256 rewardIndex = _getRewardIndex(block.timestamp);
    uint256 length = pool.tierPeriods.length;
    uint256[] memory sharesPerTiers = new uint256[](length);
    for (uint256 i = 0; i < length; ++i) {
      sharesPerTiers[i] = totalSharesOnTiers[rewardIndex][i];
    }
    return sharesPerTiers;
  }

  /**
   * @notice Get total pending harvest to claim
   */
  function pendingHarvest(address account) public view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    // Should add pending harvest at current reward period
    uint256 harvestTotal = userInfo.harvestTotal;
    uint256 tierCount = pool.tierPeriods.length;
    for (
      uint256 rewardIndex = userInfo.lastRewardIndex;
      rewardIndex < pool.lastRewardIndex;
      ++rewardIndex
    ) {
      for (uint256 tierIndex = 0; tierIndex < tierCount; ++tierIndex) {
        harvestTotal += _calculateReward(rewardIndex, tierIndex, account);
      }
    }
    return harvestTotal - userInfo.harvestClaimed;
  }
}
