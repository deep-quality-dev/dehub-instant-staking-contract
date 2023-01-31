// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.9;

interface IDeHubStaking {
  // Info of each user.
  struct UserInfo {
    // Track total staked amount by the holder.
    uint256 totalAmount;
    // Unlock timestamp;
    uint256 unlockAt;
    // Last tier index
    uint256 lastTierIndex;
    // Last reward index
    uint256 lastRewardIndex;
    // Accumulated total rewards
    uint256 harvestTotal;
    // Accumulated claimed rewards
    uint256 harvestClaimed;
  }

  struct Reward {
    // Rewarded block timestamp
    uint256 fundedAt;
    // Reward amount
    uint256 amount;
  }

  event RewardPeriod(uint256 rewardPeriod);
  event ForceUnstakeFee(uint256 forceUnstakeFee);
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
  event FundedReward(uint256 indexed rewardIndex, uint256 amount);
  event Claimed(address indexed user, uint256 amount);
}
