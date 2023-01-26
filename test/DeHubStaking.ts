import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  DeHubStaking,
  DeHubStaking__factory,
  MockERC20,
  MockERC20__factory,
} from "../typechain-types";
import { restoreSnapshot, takeSnapshot } from "./utils/helpers";
import { BigNumber } from "ethers";

describe("DeHubStaking", function () {
  let accounts: SignerWithAddress[];
  let creator: SignerWithAddress,
    stakerA: SignerWithAddress,
    stakerB: SignerWithAddress,
    stakerC: SignerWithAddress,
    funder: SignerWithAddress,
    userA: SignerWithAddress;

  let lastSnapshotId: string,
    now: number,
    rewardStartAt: number,
    rewardEndAt: number,
    currentRewardIndex: number;

  let dehubToken: MockERC20, rewardToken: MockERC20, dehubStaking: DeHubStaking;

  const shareMultipler = 10000;
  const rewardPeriod = 15000; // in seconds
  const forceUnstakeFee = 1200; // 12% in 10000 as 100%
  const tierPeriods = [10000, 20000, 50000]; // in seconds
  const tierPercents = [2500, 2500, 5000]; // 100% in 10000
  const skipSeconds = 3;

  async function doStake(
    staker: SignerWithAddress,
    period: number,
    amount: BigNumber
  ) {
    await dehubToken.connect(creator).mintTo(staker.address, amount);
    await dehubToken.connect(staker).approve(dehubStaking.address, amount);

    return await dehubStaking.connect(staker).stake(period, amount);
  }

  async function doUnstake(staker: SignerWithAddress, amount: BigNumber) {
    await dehubStaking.connect(staker).unstake(amount);
  }

  async function doRestake(
    staker: SignerWithAddress,
    period: number,
    restakeCount: number
  ) {
    await dehubStaking.connect(staker).restake(period, restakeCount);
  }

  async function doFund(amount: BigNumber) {
    await rewardToken.connect(creator).mintTo(creator.address, amount);
    await rewardToken.connect(creator).approve(dehubStaking.address, amount);

    return await dehubStaking.connect(creator).fund(amount);
  }

  async function doClaim(staker: SignerWithAddress) {
    await dehubStaking.connect(staker).claim();
  }

  async function getRewardIndex(now: number): Promise<number> {
    return (await dehubStaking.getRewardIndex(now)).toNumber();
  }

  async function getRewardStartAt(rewardIndex: number): Promise<number> {
    return (await dehubStaking.getRewardStartAt(rewardIndex)).toNumber();
  }

  async function getRewardEndAt(rewardIndex: number): Promise<number> {
    return (await dehubStaking.getRewardEndAt(rewardIndex)).toNumber();
  }

  async function userTotalStakedAmount(staker: SignerWithAddress) {
    return await dehubStaking.userTotalStakedAmount(staker.address);
  }

  async function userTierIndex(staker: SignerWithAddress): Promise<number> {
    return (await dehubStaking.userTierIndex(staker.address)).toNumber();
  }

  async function userUnlockAt(staker: SignerWithAddress): Promise<number> {
    return (await dehubStaking.userUnlockAt(staker.address)).toNumber();
  }

  async function userPendingHarvest(staker: SignerWithAddress) {
    return await dehubStaking.pendingHarvest(staker.address);
  }

  before(async () => {
    accounts = await ethers.getSigners();
    [creator, funder, stakerA, stakerB, stakerC, userA] = accounts;

    const MockERC20Factory = new MockERC20__factory(creator);
    dehubToken = await MockERC20Factory.deploy("DeHub", "DHB");
    rewardToken = await MockERC20Factory.deploy("Reward", "RWD");

    const DeHubStakingFactory = new DeHubStaking__factory(creator);
    dehubStaking = await DeHubStakingFactory.deploy();
    await dehubStaking.__DeHubStaking_init(
      dehubToken.address,
      rewardToken.address,
      rewardPeriod,
      forceUnstakeFee,
      tierPeriods,
      tierPercents
    );
  });

  beforeEach(async () => {
    lastSnapshotId = await takeSnapshot();

    now = await time.latest();
    currentRewardIndex = await getRewardIndex(now);

    [rewardStartAt, rewardEndAt] = [
      await getRewardStartAt(currentRewardIndex),
      await getRewardEndAt(currentRewardIndex),
    ];
  });

  afterEach(async () => {
    await restoreSnapshot(lastSnapshotId);
  });

  describe("Deployoment", async () => {
    it("Should set tokens", async () => {
      expect(await dehubStaking.dehubToken()).to.be.equal(dehubToken.address);
      expect(await dehubStaking.rewardToken()).to.be.equal(rewardToken.address);
    });

    it("Should set tier periods", async () => {
      const pool = await dehubStaking.getPoolInfo();
      for (let i = 0; i < tierPeriods.length; i++) {
        expect(pool.tierPeriods[i]).to.be.equal(tierPeriods[i]);
        expect(pool.tierPercents[i]).to.be.equal(tierPercents[i]);
      }
    });
  });

  describe("Pausable", async () => {
    beforeEach(async () => {
      const paused = await dehubStaking.paused();
      if (paused) {
        await dehubStaking.connect(creator).unpause();
      }
    });

    it("Should revert calling stake when paused", async () => {
      await dehubStaking.connect(creator).pause();

      const amount = ethers.utils.parseEther("100");
      await expect(
        dehubStaking.connect(userA).stake(0, amount)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert calling fund when paused", async () => {
      await dehubStaking.connect(creator).pause();

      const amount = ethers.utils.parseEther("100");
      await expect(doFund(amount)).to.be.revertedWith("Pausable: paused");
    });
  });

  describe("Permission", async () => {});

  describe("Fund", async () => {
    it("Should not revert when fund", async () => {
      const amount = ethers.utils.parseEther("100");
      await expect(doFund(amount)).to.be.not.reverted;
    });
  });

  describe("Stake", async () => {
    it("Should not revert when stake on tiers", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = 40000;
      await expect(doStake(stakerA, period, amount)).to.not.be.reverted;

      // Check user staked amount
      const stakedAmount = await userTotalStakedAmount(stakerA);
      expect(stakedAmount).to.be.equal(amount);
      // Check tier index
      const tierIndex = await userTierIndex(stakerA);
      expect(tierIndex).to.be.equal(1);

      // Check unlock timestamp
      const unlockAt = await userUnlockAt(stakerA);
      expect(unlockAt).to.be.equal(now + period + skipSeconds);
    });

    it("Should revert when stake on diffierent tier", async () => {
      const amount = ethers.utils.parseEther("100");
      const period1 = 15000;
      await doStake(stakerA, period1, amount);

      const period2 = 25000;
      await expect(
        doStake(stakerA, period2, amount)
      ).to.be.revertedWith("Different tier index with previous one");

      const period3 = 10000;
      await expect(doStake(stakerA, period3, amount)).to.be.not.reverted;

      const period4 = 5000;
      await expect(doStake(stakerA, period4, amount)).to.be.not.reverted;
    });

    it("Should not revert to change tier in the next reward period", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      await doStake(stakerA, period, stakeAmount);

      await time.increaseTo(rewardEndAt);

      const tierIndex2 = 1;
      const period2 = tierPeriods[tierIndex2];
      await expect(doStake(stakerA, period2, stakeAmount)).to.not.be.reverted;
    });

    it("Should stake multiple times on the same tier in a reward period", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = tierPeriods[0];
      const count = 5;
      let totalAmount: BigNumber = BigNumber.from(0);
      for (let i = 0; i < count; ++i) {
        await doStake(stakerA, period, amount.mul(i + 1));
        totalAmount = totalAmount.add(amount.mul(i + 1));
      }

      const userInfo = await dehubStaking.userInfos(stakerA.address);
      expect(userInfo.totalAmount).to.be.equal(totalAmount);
    });

    it("Should stake multiple times in different reward periods", async () => {
      const amountA = ethers.utils.parseEther("100");
      const period1 = tierPeriods[0];
      // Stake on tier1
      await doStake(stakerA, period1, amountA);

      // Stake on tier3
      const amountC = ethers.utils.parseEther("300");
      const tierIndex3 = 2;
      const period3 = tierPeriods[tierIndex3];
      await time.increaseTo(
        Math.floor(rewardStartAt + tierPeriods[0] / 2) - skipSeconds
      );
      await doStake(stakerC, period3, amountC);

      // Stake on tier2
      const amountB = ethers.utils.parseEther("200");
      const tierIndex2 = 1;
      const period2 = tierPeriods[tierIndex2];
      await time.increaseTo(
        Math.floor(rewardEndAt - period2 / 4) - skipSeconds
      );
      await doStake(stakerB, period2, amountB);

      // Check total shares and staking shares
      const stakingShareB = amountB.mul(shareMultipler);
      const totalSharesBOnT2R1 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex,
        tierIndex2
      );
      expect(totalSharesBOnT2R1).to.be.equal(stakingShareB.div(4));
      const stakingShareBOnT2R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex2,
        stakerB.address
      );
      expect(stakingShareBOnT2R1).to.be.equal(stakingShareB.div(4));
      const totalSharesBOnT2R2 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex + 1,
        tierIndex2
      );
      expect(totalSharesBOnT2R2).to.be.equal(stakingShareB.mul(3).div(4));
      const stakingShareBOnT2R2 = await dehubStaking.stakingShares(
        currentRewardIndex + 1,
        tierIndex2,
        stakerB.address
      );
      expect(stakingShareBOnT2R2).to.be.equal(stakingShareB.mul(3).div(4));
      expect(totalSharesBOnT2R1.add(totalSharesBOnT2R2)).to.be.equal(
        stakingShareB
      );
      expect(stakingShareBOnT2R1.add(stakingShareBOnT2R2)).to.be.equal(
        stakingShareB
      );

      // Check total shares and staking shares
      const stakingShareC = amountC.mul(shareMultipler);
      const totalSharesCOnT3R1 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex,
        tierIndex3
      );
      expect(totalSharesCOnT3R1).to.be.equal(stakingShareC.div(5));
      const stakingShareCOnT3R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex3,
        stakerC.address
      );
      expect(stakingShareCOnT3R1).to.be.equal(stakingShareC.div(5));

      const totalSharesCOnT3R2 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex + 1,
        tierIndex3
      );
      expect(totalSharesCOnT3R2).to.be.equal(stakingShareC.mul(15).div(50));
      const stakingShareCOnT3R2 = await dehubStaking.stakingShares(
        currentRewardIndex + 1,
        tierIndex3,
        stakerC.address
      );
      expect(stakingShareCOnT3R2).to.be.equal(stakingShareC.mul(15).div(50));

      const totalSharesCOnT3R3 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex + 2,
        tierIndex3
      );
      expect(totalSharesCOnT3R3).to.be.equal(stakingShareC.mul(15).div(50));
      const stakingShareCOnT3R3 = await dehubStaking.stakingShares(
        currentRewardIndex + 2,
        tierIndex3,
        stakerC.address
      );
      expect(stakingShareCOnT3R3).to.be.equal(stakingShareC.mul(15).div(50));

      const totalSharesCOnT3R4 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex + 3,
        tierIndex3
      );
      expect(totalSharesCOnT3R4).to.be.equal(stakingShareC.div(5));
      const stakingShareCOnT3R4 = await dehubStaking.stakingShares(
        currentRewardIndex + 3,
        tierIndex3,
        stakerC.address
      );
      expect(stakingShareCOnT3R4).to.be.equal(stakingShareC.div(5));

      expect(
        totalSharesCOnT3R1
          .add(totalSharesCOnT3R2)
          .add(totalSharesCOnT3R3)
          .add(totalSharesCOnT3R4)
      ).to.be.equal(stakingShareC);
      expect(
        stakingShareCOnT3R1
          .add(stakingShareCOnT3R2)
          .add(stakingShareCOnT3R3)
          .add(stakingShareCOnT3R4)
      ).to.be.equal(stakingShareC);
    });

    it("Should increase staked amount on third tier", async () => {});

    it("Multiple users should stake multiple times on different tiers in a reward period", async () => {
      const amount = ethers.utils.parseEther("100");
      const stakers = [stakerA, stakerB, stakerC];
      const periods = [15000, 25000, 55000];
      for (let i = 0; i < stakers.length; ++i) {
        const staker = stakers[i];
        const period = periods[i];

        await doStake(staker, period, amount);
        const unlockAt = (await time.latest()) + period;

        const userStakedAmount = await userTotalStakedAmount(staker);
        expect(userStakedAmount).to.be.equal(amount);

        const userInfo = await dehubStaking.userInfos(staker.address);
        expect(userInfo.totalAmount).to.be.equal(amount);
        expect(userInfo.unlockAt).to.be.equal(unlockAt);
        expect(userInfo.lastTierIndex).to.be.equal(i);
        expect(userInfo.lastRewardIndex).to.be.equal(0);
      }
    });
  });

  describe("Unstake", async () => {
    it("Should revert calling unstake without stake", async () => {
      // Check if nothing staked till now
      const totalAmount = await userTotalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      await expect(
        doUnstake(stakerA, BigNumber.from(1))
      ).to.be.revertedWith("Invalid unstake amount");
    });

    it("Should revert when unstake more than stake", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = 10000;
      await doStake(stakerA, period, amount);

      await time.increase(period);

      await expect(
        doUnstake(stakerA, amount.mul(2))
      ).to.be.revertedWith("Invalid unstake amount");
    });

    it("Should unstake staked amount", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = tierPeriods[0];
      await doStake(stakerA, period, amount);

      await time.increase(period);

      const stakingShare = amount.mul(shareMultipler);
      // Check total shares and staking share before unstake
      const rewardIndex = 0,
        tierIndex = 0;
      const totalShares1 = await dehubStaking.totalSharesOnTiers(
        rewardIndex,
        tierIndex
      );
      expect(totalShares1).to.be.equal(stakingShare);
      const stakingShare1 = await dehubStaking.stakingShares(
        rewardIndex,
        tierIndex,
        stakerA.address
      );
      expect(stakingShare1).to.be.equal(stakingShare);

      await expect(doUnstake(stakerA, amount.div(4))).to.be.not.reverted;

      // Check total shares and staking share after unstake
      const totalShares2 = await dehubStaking.totalSharesOnTiers(
        rewardIndex,
        tierIndex
      );
      expect(totalShares2).to.be.equal(stakingShare.mul(3).div(4));
      const stakingShare2 = await dehubStaking.stakingShares(
        rewardIndex,
        tierIndex,
        stakerA.address
      );
      expect(stakingShare2).to.be.equal(stakingShare.mul(3).div(4));

      await expect(doUnstake(stakerA, amount.mul(3).div(4))).to.be.not.reverted;

      expect(await userTotalStakedAmount(stakerA)).to.be.equal(
        BigNumber.from(0)
      );
    });

    it("Should force-unstake locked amount", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = 10000;
      await doStake(stakerA, period, amount);

      await time.increase(period / 2);

      const stakedAmount = await userTotalStakedAmount(stakerA);
      // Unstake only 88% of staked token
      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      await expect(doUnstake(stakerA, stakedAmount)).to.be.not.reverted;
      const balanceAfter = await dehubToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(
        stakedAmount.mul(10000 - forceUnstakeFee).div(10000)
      );
      expect(await userTotalStakedAmount(stakerA)).to.be.equal(
        BigNumber.from(0)
      );

      const tierIndex = 0;
      const totalShares = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex,
        tierIndex
      );
      expect(totalShares).to.be.equal(BigNumber.from(0));
      const stakingShare = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex,
        stakerA.address
      );
      expect(stakingShare).to.be.equal(BigNumber.from(0));
    });

    it("Should force-unstake locked amount in the next reward period", async () => {
      await time.increaseTo(
        rewardStartAt + (rewardPeriod * 3) / 4 - skipSeconds
      );

      const amount = ethers.utils.parseEther("100");
      const period = rewardPeriod;
      await doStake(stakerA, period, amount);
      await doFund(amount);

      await time.increaseTo(rewardEndAt);

      const stakedAmount = await userTotalStakedAmount(stakerA);
      // Unstake only 88% of staked token
      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      // await expect(doUnstake(stakerA, stakedAmount)).to.be.not.reverted;
      await doUnstake(stakerA, stakedAmount);
      const balanceAfter = await dehubToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(
        stakedAmount.mul(10000 - forceUnstakeFee).div(10000)
      );
      expect(await userTotalStakedAmount(stakerA)).to.be.equal(
        BigNumber.from(0)
      );

      const tierIndex = 0;
      // In the previous reward period, shares should not be changed
      const totalSharesOnT1R1 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex,
        tierIndex
      );
      expect(totalSharesOnT1R1).to.be.equal(amount.div(4).mul(shareMultipler));
      const stakingShareOnT1R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex,
        stakerA.address
      );
      expect(stakingShareOnT1R1).to.be.equal(amount.div(4).mul(shareMultipler));

      // In the next reward period, shares should be removed
      const totalSharesOnT1R2 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex + 1,
        tierIndex
      );
      expect(totalSharesOnT1R2).to.be.equal(BigNumber.from(0));
      const stakingShareOnT1R2 = await dehubStaking.stakingShares(
        currentRewardIndex + 1,
        tierIndex,
        stakerA.address
      );
      expect(stakingShareOnT1R2).to.be.equal(BigNumber.from(0));
    });

    it("Should unstake amount multiple staked", async () => {
      const amount = ethers.utils.parseEther("100");
      const period = 10000;

      const count = 5;
      let sumOfAmount = BigNumber.from(0);
      for (let i = 0; i < count; ++i) {
        await doStake(stakerA, period, amount.mul(i + 1));
        sumOfAmount = sumOfAmount.add(amount.mul(i + 1));
        await time.increase(10); // pass 10 second
      }

      expect(await userTotalStakedAmount(stakerA)).to.be.equal(sumOfAmount);
      // NOTE, If unstake now, then it will be force-unstaking

      await time.increase(period);

      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      await expect(doUnstake(stakerA, sumOfAmount)).to.be.not.reverted;
      const balanceAfter = await dehubToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(sumOfAmount);

      expect(await userTotalStakedAmount(stakerA)).to.be.equal(
        BigNumber.from(0)
      );
    });

    it("Should unstake amount by different users", async () => {
      const amounts = [
        ethers.utils.parseEther("100"),
        ethers.utils.parseEther("200"),
        ethers.utils.parseEther("300"),
      ];
      const periods = [
        tierPeriods[0],
        tierPeriods[0],
        (tierPeriods[0] * 3) / 2,
      ];
      // Stake on tier1
      await doStake(stakerA, periods[0], amounts[0]);
      await time.increaseTo(rewardStartAt + rewardPeriod / 3 - skipSeconds);
      await doStake(stakerB, periods[1], amounts[1]);
      await time.increaseTo(
        rewardStartAt + (rewardPeriod * 3) / 4 - skipSeconds
      );
      await doStake(stakerC, periods[2], amounts[2]);

      await time.increaseTo(rewardEndAt + periods[2] - skipSeconds);

      // Unstake stakerC
      await doUnstake(stakerC, amounts[2].mul(2).div(3));

      // Check total shares and staking shares
      const tierIndex1 = 0;
      const totalSharesOnT1R1 = await dehubStaking.totalSharesOnTiers(
        currentRewardIndex,
        tierIndex1
      );
      const stakingShareAOnT1R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex1,
        stakerA.address
      );
      const stakingShareBOnT1R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex1,
        stakerB.address
      );
      const stakingShareCOnT1R1 = await dehubStaking.stakingShares(
        currentRewardIndex,
        tierIndex1,
        stakerC.address
      );
      expect(totalSharesOnT1R1).to.be.equal(
        stakingShareAOnT1R1.add(stakingShareBOnT1R1).add(stakingShareCOnT1R1)
      );
      expect(stakingShareAOnT1R1).to.be.equal(amounts[0].mul(shareMultipler));
      expect(stakingShareBOnT1R1).to.be.equal(amounts[1].mul(shareMultipler));
      expect(stakingShareCOnT1R1).to.be.equal(
        amounts[2].mul(shareMultipler).div(4)
      );
      const stakingShareCOnT1R2 = await dehubStaking.stakingShares(
        currentRewardIndex + 1,
        tierIndex1,
        stakerC.address
      );
      expect(stakingShareCOnT1R2).to.be.equal(
        amounts[2].mul(shareMultipler).div(12)
      );
    });
  });

  describe("Pending Harvest", async () => {
    it("Should be zero before funding", async () => {
      // Check if nothing staked till now
      const totalAmount = await userTotalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      expect(pendingHarvest).to.be.equal(BigNumber.from(0));
    });

    it("Should have pending harvest after funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      await doStake(stakerA, period, stakeAmount);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await time.increaseTo(rewardEndAt);

      const pendingHarvest = await userPendingHarvest(stakerA);
      const rewardAmount = fundAmount.mul(tierPercents[tierIndex]).div(10000);
      expect(pendingHarvest).to.be.equal(rewardAmount);
    });

    it("Should not be changed before funding again", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      await doStake(stakerA, period, stakeAmount);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await time.increaseTo(rewardEndAt);

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      const rewardAmount = fundAmount.mul(tierPercents[tierIndex]).div(10000);
      expect(pendingHarvest).to.be.equal(rewardAmount);

      await doStake(stakerA, period, stakeAmount);
      const pendingHarvest2 = await dehubStaking.pendingHarvest(
        stakerA.address
      );
      expect(pendingHarvest2).to.be.equal(rewardAmount);
    });

    it("Should be different per different tiers", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      // Different stakers stake on different tier with same amount
      const stakers = [stakerA, stakerB, stakerC];
      for (let i = 0; i < stakers.length; i++) {
        const tierIndex = i;
        const period = tierPeriods[tierIndex];
        await doStake(stakers[i], period, stakeAmount);
      }

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await time.increase(tierPeriods[2]);

      for (let i = 0; i < stakers.length; i++) {
        const pendingHarvest = await userPendingHarvest(stakers[i]);
        expect(pendingHarvest).to.be.equal(
          fundAmount.mul(tierPercents[i]).div(10000)
        );
      }
    });
  });

  describe("Claim", async () => {
    it("Should be reverted if claimable amount is zero", async () => {
      // Check if nothing staked till now
      const totalAmount = await userTotalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      await expect(doClaim(stakerA)).to.be.revertedWith(
        "Nothing to harvest"
      );
    });

    it("Should claim after funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      await doStake(stakerA, period, stakeAmount);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await time.increaseTo(rewardEndAt);

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      const balanceBefore = await rewardToken.balanceOf(stakerA.address);
      await doClaim(stakerA);
      const balanceAfter = await rewardToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(pendingHarvest);

      const userInfo = await dehubStaking.userInfos(stakerA.address);
      expect(userInfo.harvestClaimed).to.be.equal(pendingHarvest);
    });

    it("Should revert when claim again before second funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      await doStake(stakerA, period, stakeAmount);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await time.increaseTo(rewardEndAt);

      await expect(doClaim(stakerA)).to.be.not.reverted;
      await expect(doClaim(stakerA)).to.be.revertedWith(
        "Nothing to harvest"
      );
    });

    it("Should claim multiple times", async () => {
      const tierIndex = 0;
      const period = tierPeriods[tierIndex];
      // Stake
      const stakeAmount1 = ethers.utils.parseEther("100");
      await doStake(stakerA, period, stakeAmount1);
      // Fund
      const fundAmount1 = ethers.utils.parseEther("1000");
      await doFund(fundAmount1);
      await time.increaseTo(rewardEndAt);
      // Stake
      const stakeAmount2 = ethers.utils.parseEther("200");
      await doStake(stakerA, period, stakeAmount2);
      // Claim
      await doClaim(stakerA);
      // Fund
      const fundAmount2 = ethers.utils.parseEther("2000");
      await doFund(fundAmount2);
      [rewardStartAt, rewardEndAt] = [
        await getRewardStartAt(currentRewardIndex + 1),
        await getRewardEndAt(currentRewardIndex + 1),
      ];
      await time.increaseTo(rewardEndAt);
      // Claim
      await expect(doClaim(stakerA)).to.be.not.reverted;
      // Unstake all

      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      const userInfo = await dehubStaking.userInfos(stakerA.address);
      await doUnstake(stakerA, userInfo.totalAmount);
      const balanceAfter = await dehubToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(
        stakeAmount1.add(stakeAmount2)
      );
    });
  });

  describe("Integration", async () => {
    describe("Stake & Fund & Claim", async () => {
      it("Should claim all at once when staked & funded multiple times", async () => {
        const tierIndex = 0;
        // Stake
        const stakeAmount1 = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
        await time.increaseTo(rewardEndAt);
        // Stake
        const stakeAmount2 = ethers.utils.parseEther("200");
        await doStake(stakerA, period, stakeAmount2);
        // Fund
        const fundAmount2 = ethers.utils.parseEther("2000");
        await doFund(fundAmount2);
        [rewardStartAt, rewardEndAt] = [
          await getRewardStartAt(currentRewardIndex + 1),
          await getRewardEndAt(currentRewardIndex + 1),
        ];
        await time.increaseTo(rewardEndAt);

        const claimableA = fundAmount1
          .mul(tierPercents[tierIndex])
          .div(10000)
          .add(fundAmount2.mul(tierPercents[tierIndex]).div(10000));

        const balanceBefore = await rewardToken.balanceOf(stakerA.address);
        await dehubStaking.connect(stakerA).claim();
        const balanceAfter = await rewardToken.balanceOf(stakerA.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(claimableA);
      });
    });

    describe("Stake & Unstake & Fund & Claim", async () => {
      it("Should unstake amount regardless of claiming", async () => {
        const tierIndex = 0;
        // Stake
        const stakeAmount1 = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
      });

      it("Should calculate pending harvest with snapshot of funding", async () => {
        const tierIndex = 0;
        // Stake
        const stakeAmount1 = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
        await time.increaseTo(rewardEndAt);
        const claimable1 = fundAmount1.mul(tierPercents[tierIndex]).div(10000);
        // Stake & Unstake
        const stakeAmount2 = ethers.utils.parseEther("200");
        await doStake(stakerA, period, stakeAmount2);
        // NOTE, If unstake now, then it will be force-unstaking
        // Fund
        const fundAmount2 = ethers.utils.parseEther("2000");
        await doFund(fundAmount2);
        const claimable2 = fundAmount2.mul(tierPercents[tierIndex]).div(10000);
        // Claim
        const balanceBefore = await rewardToken.balanceOf(stakerA.address);
        await dehubStaking.connect(stakerA).claim();
        const balanceAfter = await rewardToken.balanceOf(stakerA.address);
        expect(balanceAfter.sub(balanceBefore)).to.be.equal(
          claimable1.add(claimable2)
        );
      });

      it("Should simulate plan A", async () => {
        const rewardPeriodA = 20000;
        const tierPeriodsA = [10000, 20000]; // in seconds
        const tierPercentsA = [5000, 5000]; // 100% in 10000
        await dehubStaking
          .connect(creator)
          .setTierPeriods(tierPeriodsA, tierPercentsA);
        await dehubStaking.connect(creator).setRewardPeriod(rewardPeriodA);

        now = await time.latest();
        currentRewardIndex = await getRewardIndex(now);
        [rewardStartAt, rewardEndAt] = [
          await getRewardStartAt(currentRewardIndex),
          await getRewardEndAt(currentRewardIndex),
        ];

        const stakeAmount = ethers.utils.parseEther("100");
        const fundAmount = ethers.utils.parseEther("20");
        // Stake A,B,C
        await doStake(stakerA, tierPeriodsA[0], stakeAmount);
        await time.increaseTo(
          rewardStartAt + tierPeriodsA[0] / 2 - skipSeconds
        );
        await doStake(stakerB, tierPeriodsA[1], stakeAmount);
        await time.increaseTo(rewardStartAt + tierPeriodsA[0] - skipSeconds);
        await doStake(stakerC, tierPeriodsA[0], stakeAmount);
        // await time.increaseTo(
        //   rewardStartAt + (tierPeriodsA[0] * 3) / 2 - skipSeconds
        // );
        // Fund
        await doFund(fundAmount);
        await time.increaseTo(rewardEndAt - skipSeconds);
        // Next reward period
        [rewardStartAt, rewardEndAt] = [
          await getRewardStartAt(currentRewardIndex + 1),
          await getRewardEndAt(currentRewardIndex + 1),
        ];
        expect(await userPendingHarvest(stakerA)).to.be.equal(
          ethers.utils.parseEther("5")
        );
        expect(await userPendingHarvest(stakerB)).to.be.equal(
          ethers.utils.parseEther("10")
        );
        expect(await userPendingHarvest(stakerC)).to.be.equal(
          ethers.utils.parseEther("5")
        );

        // Stake A,B,C
        await doStake(stakerA, tierPeriodsA[1], stakeAmount);
        await time.increaseTo(
          rewardStartAt + tierPeriodsA[0] / 2 - skipSeconds
        );
        await doStake(stakerC, tierPeriodsA[0], stakeAmount);
        await time.increaseTo(rewardStartAt + tierPeriodsA[0] - skipSeconds);
        // await doStake(stakerB, tierPeriodsA[0], stakeAmount);
        // await time.increaseTo(
        //   rewardStartAt + (tierPeriodsA[0] * 3) / 2 - skipSeconds
        // );
        // Fund
        await doFund(fundAmount);
        await time.increaseTo(rewardEndAt - skipSeconds);
        // Next reward period
        [rewardStartAt, rewardEndAt] = [
          await getRewardStartAt(currentRewardIndex + 2),
          await getRewardEndAt(currentRewardIndex + 2),
        ];
        expect(await userPendingHarvest(stakerA)).to.be.equal(
          ethers.utils.parseEther("5").add(fundAmount.div(2).mul(4).div(5))
        );
        expect(await userPendingHarvest(stakerB)).to.be.equal(
          ethers.utils.parseEther("10").add(fundAmount.div(2).div(5))
        );
        expect(await userPendingHarvest(stakerC)).to.be.equal(
          ethers.utils.parseEther("5").add(fundAmount.div(2))
        );

        // Stake A,B,C
        await doStake(stakerC, tierPeriodsA[1], stakeAmount);
        await time.increaseTo(
          rewardStartAt + tierPeriodsA[0] / 2 - skipSeconds * 2
        );
        await doStake(stakerA, tierPeriodsA[0], stakeAmount);
        await doStake(stakerB, tierPeriodsA[0], stakeAmount);
        await time.increaseTo(rewardEndAt - tierPeriodsA[0] / 2 - skipSeconds);
        await doStake(stakerA, tierPeriodsA[0], stakeAmount);
        // Fund
        await doFund(fundAmount);
        await time.increaseTo(rewardEndAt);
        // Next reward period
        [rewardStartAt, rewardEndAt] = [
          await getRewardStartAt(currentRewardIndex + 2),
          await getRewardEndAt(currentRewardIndex + 2),
        ];

        expect(await userPendingHarvest(stakerA)).to.be.equal(
          ethers.utils.parseEther("13").add(fundAmount.div(2).mul(3).div(5))
        );
        expect(await userPendingHarvest(stakerB)).to.be.equal(
          ethers.utils.parseEther("12").add(fundAmount.div(2).mul(2).div(5))
        );
        expect(await userPendingHarvest(stakerC)).to.be.equal(
          ethers.utils.parseEther("15").add(fundAmount.div(2))
        );
      });
    });

    describe("Restake", async () => {
      it("Should restake", async () => {
        const tierIndex = 1;
        // Stake
        const stakeAmount = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount);

        await time.increaseTo(rewardEndAt - period / 2 - 1);

        const restakeCount = 1;
        await expect(doRestake(stakerA, period, restakeCount)).to.be.not
          .reverted;

        // Check total shares
        const stakingShareA = stakeAmount
          .mul(shareMultipler)
          .mul(10000 - forceUnstakeFee)
          .div(10000);

        const totalSharesAOnT1R1 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex,
          tierIndex
        );
        expect(totalSharesAOnT1R1).to.be.equal(stakingShareA.div(2));
        const stakingShareAOnT1R1 = await dehubStaking.stakingShares(
          currentRewardIndex,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R1).to.be.equal(stakingShareA.div(2));
        const totalSharesAOnT1R2 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 1,
          tierIndex
        );
        expect(totalSharesAOnT1R2).to.be.equal(stakingShareA.div(2));
        const stakingShareAOnT1R2 = await dehubStaking.stakingShares(
          currentRewardIndex + 1,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R2).to.be.equal(stakingShareA.div(2));
        expect(totalSharesAOnT1R1.add(totalSharesAOnT1R2)).to.be.equal(
          stakingShareA
        );
      });

      it("Should force-restake n-times without funding", async () => {
        const tierIndex = 1;
        // Stake
        const stakeAmount = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount);

        await time.increaseTo(rewardEndAt - period / 2 - 1);

        // Restake n-times
        const restakeCount = 3;
        await expect(doRestake(stakerA, period, restakeCount)).to.be.not
          .reverted;

        // Check total shares
        const stakingShareA = stakeAmount
          .mul(shareMultipler)
          .mul(10000 - forceUnstakeFee)
          .div(10000);

        const totalSharesAOnT1R1 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex,
          tierIndex
        );
        expect(totalSharesAOnT1R1).to.be.equal(stakingShareA.div(6));
        const stakingShareAOnT1R1 = await dehubStaking.stakingShares(
          currentRewardIndex,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R1).to.be.equal(stakingShareA.div(6));

        const totalSharesAOnT1R2 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 1,
          tierIndex
        );
        expect(totalSharesAOnT1R2).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R2 = await dehubStaking.stakingShares(
          currentRewardIndex + 1,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R2).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R3 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 2,
          tierIndex
        );
        expect(totalSharesAOnT1R3).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R3 = await dehubStaking.stakingShares(
          currentRewardIndex + 2,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R3).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R4 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 3,
          tierIndex
        );
        expect(totalSharesAOnT1R4).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R4 = await dehubStaking.stakingShares(
          currentRewardIndex + 3,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R4).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R5 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 4,
          tierIndex
        );
        expect(totalSharesAOnT1R5).to.be.equal(stakingShareA.div(12));
        const stakingShareAOnT1R5 = await dehubStaking.stakingShares(
          currentRewardIndex + 4,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R5).to.be.equal(stakingShareA.div(12));
        expect(
          totalSharesAOnT1R1
            .add(totalSharesAOnT1R2)
            .add(totalSharesAOnT1R3)
            .add(totalSharesAOnT1R4)
            .add(totalSharesAOnT1R5)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
        expect(
          stakingShareAOnT1R1
            .add(stakingShareAOnT1R2)
            .add(stakingShareAOnT1R3)
            .add(stakingShareAOnT1R4)
            .add(stakingShareAOnT1R5)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
      });

      it("Should force-restake amount staked n-times after funding", async () => {
        const tierIndex = 1;
        // Stake
        const stakeAmount = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount);
        await doStake(stakerA, period, stakeAmount);
        await doStake(stakerA, period, stakeAmount);
        await doStake(stakerA, period, stakeAmount);

        // Fund
        const fundAmount = ethers.utils.parseEther("1000");
        await doFund(fundAmount);

        // Wait to unlock
        await time.increaseTo(rewardEndAt + period / 4 - 4);
        await doStake(stakerA, period, stakeAmount);

        // Restake n-times
        const restakeCount = 3;
        await expect(doRestake(stakerA, period, restakeCount)).to.be.not
          .reverted;

        // Check total shares
        const stakingShareA = stakeAmount
          .mul(shareMultipler)
          .mul(5)
          .mul(10000 - forceUnstakeFee)
          .div(10000);

        const totalSharesAOnT1R1 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 1,
          tierIndex
        );
        expect(totalSharesAOnT1R1).to.be.equal(stakingShareA.div(6));
        const stakingShareAOnT1R1 = await dehubStaking.stakingShares(
          currentRewardIndex + 1,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R1).to.be.equal(stakingShareA.div(6));

        const totalSharesAOnT1R2 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 2,
          tierIndex
        );
        expect(totalSharesAOnT1R2).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R2 = await dehubStaking.stakingShares(
          currentRewardIndex + 2,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R2).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R3 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 3,
          tierIndex
        );
        expect(totalSharesAOnT1R3).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R3 = await dehubStaking.stakingShares(
          currentRewardIndex + 3,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R3).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R4 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 4,
          tierIndex
        );
        expect(totalSharesAOnT1R4).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R4 = await dehubStaking.stakingShares(
          currentRewardIndex + 4,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R4).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R5 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 5,
          tierIndex
        );
        expect(totalSharesAOnT1R5).to.be.equal(stakingShareA.div(12));
        const stakingShareAOnT1R5 = await dehubStaking.stakingShares(
          currentRewardIndex + 5,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R5).to.be.equal(stakingShareA.div(12));
        expect(
          totalSharesAOnT1R1
            .add(totalSharesAOnT1R2)
            .add(totalSharesAOnT1R3)
            .add(totalSharesAOnT1R4)
            .add(totalSharesAOnT1R5)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
        expect(
          stakingShareAOnT1R1
            .add(stakingShareAOnT1R2)
            .add(stakingShareAOnT1R3)
            .add(stakingShareAOnT1R4)
            .add(stakingShareAOnT1R5)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
      });

      it("Should force-restake n-times after funding", async () => {
        const tierIndex = 1;
        // Stake
        const stakeAmount = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount);

        // Fund
        const fundAmount = ethers.utils.parseEther("1000");
        await doFund(fundAmount);

        // Wait to unlock
        await time.increaseTo(rewardEndAt + period / 4 - 1);

        // Restake n-times
        const restakeCount = 3;
        await expect(doRestake(stakerA, period, restakeCount)).to.be.not
          .reverted;

        // Check total shares
        const stakingShareA = stakeAmount
          .mul(shareMultipler)
          .mul(10000 - forceUnstakeFee)
          .div(10000);

        const totalSharesAOnT1R2 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 1,
          tierIndex
        );
        expect(totalSharesAOnT1R2).to.be.equal(stakingShareA.div(6));
        const stakingShareAOnT1R2 = await dehubStaking.stakingShares(
          currentRewardIndex + 1,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R2).to.be.equal(stakingShareA.div(6));

        const totalSharesAOnT1R3 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 2,
          tierIndex
        );
        expect(totalSharesAOnT1R3).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R3 = await dehubStaking.stakingShares(
          currentRewardIndex + 2,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R3).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R4 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 3,
          tierIndex
        );
        expect(totalSharesAOnT1R4).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R4 = await dehubStaking.stakingShares(
          currentRewardIndex + 3,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R4).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R5 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 4,
          tierIndex
        );
        expect(totalSharesAOnT1R5).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R5 = await dehubStaking.stakingShares(
          currentRewardIndex + 4,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R5).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R6 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 5,
          tierIndex
        );
        expect(totalSharesAOnT1R6).to.be.equal(stakingShareA.div(12));
        const stakingShareAOnT1R6 = await dehubStaking.stakingShares(
          currentRewardIndex + 5,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R6).to.be.equal(stakingShareA.div(12));
        expect(
          totalSharesAOnT1R2
            .add(totalSharesAOnT1R3)
            .add(totalSharesAOnT1R4)
            .add(totalSharesAOnT1R5)
            .add(totalSharesAOnT1R6)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
        expect(
          stakingShareAOnT1R2
            .add(stakingShareAOnT1R3)
            .add(stakingShareAOnT1R4)
            .add(stakingShareAOnT1R5)
            .add(stakingShareAOnT1R6)
            .sub(stakingShareA)
            .abs()
        ).to.be.lte(10);
      });

      it("Should restake in the next reward period when change tier", async () => {
        const tierIndex = 0;
        // Stake
        const stakeAmount = ethers.utils.parseEther("100");
        const period = tierPeriods[tierIndex];
        await doStake(stakerA, period, stakeAmount);

        await time.increaseTo(rewardEndAt - period / 2 - 1);

        // Restake n-times with different tier
        const restakeCount = 3;
        await doRestake(stakerA, tierPeriods[tierIndex + 1], restakeCount);

        // Check total shares
        const stakingShareA = stakeAmount
          .mul(shareMultipler)
          .mul(10000 - forceUnstakeFee)
          .div(10000);

        // Should be 0 in the staked reward period
        const totalSharesAOnT1R1 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex,
          tierIndex
        );
        expect(totalSharesAOnT1R1).to.be.equal(BigNumber.from(0));
        const stakingShareAOnT1R1 = await dehubStaking.stakingShares(
          currentRewardIndex,
          tierIndex,
          stakerA.address
        );
        expect(stakingShareAOnT1R1).to.be.equal(BigNumber.from(0));

        // Should start in the next reward period
        const totalSharesAOnT1R2 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 1,
          tierIndex + 1
        );
        expect(totalSharesAOnT1R2).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R2 = await dehubStaking.stakingShares(
          currentRewardIndex + 1,
          tierIndex + 1,
          stakerA.address
        );
        expect(stakingShareAOnT1R2).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R3 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 2,
          tierIndex + 1
        );
        expect(totalSharesAOnT1R3).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R3 = await dehubStaking.stakingShares(
          currentRewardIndex + 2,
          tierIndex + 1,
          stakerA.address
        );
        expect(stakingShareAOnT1R3).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R4 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 3,
          tierIndex + 1
        );
        expect(totalSharesAOnT1R4).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R4 = await dehubStaking.stakingShares(
          currentRewardIndex + 3,
          tierIndex + 1,
          stakerA.address
        );
        expect(stakingShareAOnT1R4).to.be.equal(stakingShareA.div(4));

        const totalSharesAOnT1R5 = await dehubStaking.totalSharesOnTiers(
          currentRewardIndex + 4,
          tierIndex + 1
        );
        expect(totalSharesAOnT1R5).to.be.equal(stakingShareA.div(4));
        const stakingShareAOnT1R5 = await dehubStaking.stakingShares(
          currentRewardIndex + 4,
          tierIndex + 1,
          stakerA.address
        );
        expect(stakingShareAOnT1R5).to.be.equal(stakingShareA.div(4));
      });
    });
  });
});
