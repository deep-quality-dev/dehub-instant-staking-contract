// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.9;

interface IDeHubStaking {
  // Info of each user.
  struct UserInfo {
    // Track total staked amount by the holder.
    uint256 totalAmount;
    // Unlock timestamp
    uint256 unlockAt;
    // Last tier index
    uint256 lastTierIndex;
    // Last reward index
    uint256 lastRewardIndex;
    // Accumulated total rewards
    uint256 harvestTotal;
    // Accumulated claimed rewards
    uint256 harvestClaimed;
    // Stake timestamp
    uint256 lastStakeAt;
  }

  struct Reward {
    // Rewarded block timestamp
    uint256 fundedAt;
    // Reward amount
    uint256 amount;
  }

  event StartAt(uint256 startAt);
  event RewardPeriod(uint256 rewardPeriod);
  event ForceUnstakeFee(uint256 forceUnstakeFee);
  event MinPeriod(uint256 minPeriod);
  event TierPeriods(uint256[] tierPeriods, uint256[] tierPercents);
  event Staked(
    address indexed user,
    uint256 period,
    uint256 amount,
    uint256 stakeAt,
    uint256 indexed rewardIndex,
    uint256 indexed tierIndex
  );
  event Unstaked(
    address indexed user,
    uint256 actualAmount,
    uint256 transferAmount,
    uint256 unstakeAt
  );
  event RemainingTransfered(address indexed user, uint256 transferAmount);
  event FundedReward(uint256 indexed rewardIndex, uint256 amount);
  event Claimed(address indexed user, uint256 amount);
}
