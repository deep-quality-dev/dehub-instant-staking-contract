// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.9;

interface IDeHubStaking {
  // Info of each user.
  struct UserInfo {
    // Track total staked amount by the holder.
    uint256 totalAmount;
    // Unlockable block timestamp
    uint256 unlockableAt;
    // Last reward index
    uint256 lastRewardIndex;
    // // Last deposit amount at last reward period
    // uint256 lastDepositAmount;
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

  event TierPeriods(uint256[] tierPeriods, uint256[] tierPercents);
  event Staked(address indexed user, uint256 amount, uint256 period);
  event Unstaked(address indexed user, uint256 amount);
  event FundedReward(uint256 amount);
  event Claimed(address indexed user, uint256 amount);
}
