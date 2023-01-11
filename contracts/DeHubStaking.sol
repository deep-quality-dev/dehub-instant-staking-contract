// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "hardhat/console.sol";
import {DeHubUpgradeable, IERC20Upgradeable, SafeMathUpgradeable, SafeERC20Upgradeable} from "./abstracts/DeHubUpgradeable.sol";
import {IDeHubStaking} from "./interfaces/IDeHubStaking.sol";

error InvalidTierPeriods();
error InvalidTier();
error NotAvailableUnstake();
error InvalidUnstakeAmount();
error InvalidRewardIndex();
error ZeroHarvestAmount();
error NotEnoughRewards();

contract DeHubStaking is DeHubUpgradeable, IDeHubStaking {
  using SafeMathUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  IERC20Upgradeable public dehubToken;
  IERC20Upgradeable public rewardToken;

  /**
   * @notice Tier periods in second, staked tokens will be locked
   * according to this period
   */
  uint256[] public tierPeriods;
  /**
   * @notice Every tier has different percent charging of rewards, 100% in 10000
   * i.e. Tier 1 = 25% of total reward, Tier 2 = 25%, Tier 3 = 50%
   * The length of tierPeriods and tierPercents should be same
   */
  uint256[] public tierPercents;
  /**
   * @notice Every time owner funds reward, increase reward index and
   * stakers can get rewards immediately
   */
  uint256 public lastRewardIndex;

  // <Reward Index, <Tier Index, Total Supply>>
  mapping(uint256 => mapping(uint256 => uint256)) public totalSupplyOnTiers;
  mapping(uint256 => Reward) public rewards;
  mapping(address => UserInfo) public userInfos;
  // <User, <Tier Index, Last Stake Amount>>
  mapping(address => mapping(uint256 => uint256)) public lastStakeAmounts;

  /* -------------------------------------------------------------------------- */
  /*                                  Modifiers                                 */
  /* -------------------------------------------------------------------------- */

  /* -------------------------------------------------------------------------- */
  /*                             External Functions                             */
  /* -------------------------------------------------------------------------- */

  function __DeHubStaking_init(
    IERC20Upgradeable dehubToken_,
    IERC20Upgradeable rewardToken_,
    uint256[] memory tierPeriods_,
    uint256[] memory tierPercents_
  ) public initializer {
    DeHubUpgradeable.initialize();

    dehubToken = dehubToken_;
    rewardToken = rewardToken_;
    tierPeriods = tierPeriods_;
    tierPercents = tierPercents_;
  }

  function setTierPeriods(
    uint256[] calldata tierPeriods_,
    uint256[] calldata tierPercents_
  ) external onlyOwner {
    if (tierPeriods_.length != tierPercents_.length) {
      revert InvalidTierPeriods();
    }
    tierPeriods = tierPeriods_;
    tierPercents = tierPercents_;
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
  function stake(uint256 tierIndex, uint256 amount) external whenNotPaused {
    if (tierIndex >= tierPeriods.length) {
      revert InvalidTier();
    }

    UserInfo storage userInfo = userInfos[msg.sender];

    // Accumulate total staked amount
    userInfo.totalAmount += amount;
    // Last block timestamp when staked tokens will be unlocked
    uint256 unblockableAt = block.timestamp + tierPeriods[tierIndex];
    userInfo.unlockableAt = userInfo.unlockableAt > unblockableAt
      ? userInfo.unlockableAt
      : unblockableAt;

    _updatePool();

    // Accumulate staked amount for current reward period per tier
    lastStakeAmounts[msg.sender][tierIndex] += amount;
    // Total supply in the current reward period per tier
    totalSupplyOnTiers[lastRewardIndex][tierIndex] += amount;

    dehubToken.safeTransferFrom(msg.sender, address(this), amount);

    emit Staked(msg.sender, amount, tierPeriods[tierIndex]);
  }

  /**
   * @notice Unstake unlocked tokens, even if user staked on different tiers,
   * unstake from tier 0 to last tier.
   */
  function unstake(uint256 amount) external whenNotPaused {
    UserInfo storage userInfo = userInfos[msg.sender];

    if (userInfo.totalAmount < amount) {
      revert InvalidUnstakeAmount();
    }
    // Stakers can't unstake until staked amount has been unlocked
    if (userInfo.unlockableAt >= block.timestamp) {
      revert NotAvailableUnstake();
    }

    _updatePool();

    uint256 unstakeAmount = amount;
    // Decrease total amount
    userInfo.totalAmount -= amount;
    // If unstake in current reward period, decrease current staked amount from tier 0 to last tier
    for (uint256 tier = 0; amount > 0 && tier < tierPeriods.length; ++tier) {
      if (lastStakeAmounts[msg.sender][tier] > amount) {
        lastStakeAmounts[msg.sender][tier] -= amount;
        totalSupplyOnTiers[lastRewardIndex][tier] -= amount;
        amount = 0;
      } else {
        amount -= lastStakeAmounts[msg.sender][tier];
        totalSupplyOnTiers[lastRewardIndex][tier] -= lastStakeAmounts[
          msg.sender
        ][tier];
        lastStakeAmounts[msg.sender][tier] = 0;
      }
    }
    dehubToken.safeTransfer(msg.sender, unstakeAmount);

    emit Unstaked(msg.sender, unstakeAmount);
  }

  /**
   * @notice Claim harvest at once, harvest is calculated at the time when owner
   * funds reward
   */
  function claim() external whenNotPaused {
    UserInfo storage userInfo = userInfos[msg.sender];

    uint256 claimable = pendingHarvest(msg.sender);
    if (claimable == 0) {
      revert ZeroHarvestAmount();
    }
    if (rewardToken.balanceOf(address(this)) < claimable) {
      revert NotEnoughRewards();
    }

    _updatePool();

    userInfo.harvestClaimed += claimable;
    rewardToken.safeTransfer(msg.sender, claimable);

    emit Claimed(msg.sender, claimable);
  }

  /**
   * @notice Fund rewards to this contract
   */
  function fund(uint256 amount) external onlyOwner whenNotPaused {
    lastRewardIndex++;
    rewards[lastRewardIndex] = Reward({
      fundedAt: block.timestamp,
      amount: amount
    });

    rewardToken.safeTransferFrom(msg.sender, address(this), amount);

    emit FundedReward(amount);
  }

  /* -------------------------------------------------------------------------- */
  /*                             Internal Functions                             */
  /* -------------------------------------------------------------------------- */

  function _updatePool() internal {
    UserInfo storage userInfo = userInfos[msg.sender];

    // If stake/unstake on the new reward period, then calculate reward
    if (userInfo.lastRewardIndex < lastRewardIndex) {
      for (uint256 tier = 0; tier < tierPeriods.length; ++tier) {
        // Calculate rewards amount and accumulate
        userInfo.harvestTotal += _calculateReward(
          userInfo.lastRewardIndex,
          tier,
          lastStakeAmounts[msg.sender][tier]
        );
        // Empty staked amount in the last reward period
        delete lastStakeAmounts[msg.sender][tier];
      }
      userInfo.lastRewardIndex = lastRewardIndex;
    }
  }

  function _calculateReward(
    uint256 rewardIndex,
    uint256 tierIndex,
    uint256 userAmount
  ) internal view returns (uint256) {
    if (rewardIndex > lastRewardIndex) {
      revert InvalidRewardIndex();
    }
    uint256 totalSupplyOnTier = totalSupplyOnTiers[rewardIndex][tierIndex];
    if (totalSupplyOnTier == 0) {
      return 0;
    }

    uint256 rewardsAmount = (((rewards[rewardIndex + 1].amount *
      tierPercents[tierIndex]) / 10000) * userAmount) / totalSupplyOnTier;
    return rewardsAmount;
  }

  /* -------------------------------------------------------------------------- */
  /*                               View Functions                               */
  /* -------------------------------------------------------------------------- */

  /**
   * @notice Get total staked amount in current reward period
   */
  function userStakedAmounts(
    address account
  ) external view returns (uint256[] memory) {
    uint256 tiers = tierPeriods.length;
    uint256[] memory amounts = new uint256[](tiers);
    for (uint256 i = 0; i < tiers; ++i) {
      amounts[i] = lastStakeAmounts[account][i];
    }
    return amounts;
  }

  /**
   * @notice Get total pending harvest to claim
   */
  function pendingHarvest(address account) public view returns (uint256) {
    UserInfo storage userInfo = userInfos[account];
    // Should add pending harvest at current reward period
    uint256 harvestTotal = userInfo.harvestTotal;
    if (userInfo.lastRewardIndex < lastRewardIndex) {
      for (uint256 tier = 0; tier < tierPeriods.length; ++tier) {
        harvestTotal += _calculateReward(
          userInfo.lastRewardIndex,
          tier,
          lastStakeAmounts[account][tier]
        );
      }
    }
    return harvestTotal - userInfo.harvestClaimed;
  }
}
