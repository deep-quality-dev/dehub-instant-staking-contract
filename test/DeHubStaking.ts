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

  let lastSnapshotId: string;

  let dehubToken: MockERC20, rewardToken: MockERC20, dehubStaking: DeHubStaking;

  const tierPeriods = [100, 200, 300]; // in seconds
  const tierPercents = [2500, 2500, 5000]; // 100% in 10000

  async function doStake(
    staker: SignerWithAddress,
    tierIndex: number,
    amount: BigNumber
  ) {
    await dehubToken.connect(creator).mintTo(staker.address, amount);
    await dehubToken.connect(staker).approve(dehubStaking.address, amount);

    return await dehubStaking.connect(staker).stake(tierIndex, amount);
  }

  async function doFund(amount: BigNumber) {
    await rewardToken.connect(creator).mintTo(creator.address, amount);
    await rewardToken.connect(creator).approve(dehubStaking.address, amount);

    return await dehubStaking.connect(creator).fund(amount);
  }

  async function totalStakedAmount(staker: SignerWithAddress) {
    const amounts = await dehubStaking.userStakedAmounts(staker.address);
    const totalAmount = amounts.reduce(
      (prev, current) => prev.add(current),
      BigNumber.from(0)
    );
    return totalAmount;
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
      tierPeriods,
      tierPercents
    );
  });

  beforeEach(async () => {
    lastSnapshotId = await takeSnapshot();
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
      for (let i = 0; i < tierPeriods.length; i++) {
        expect(await dehubStaking.tierPeriods(i)).to.be.equal(tierPeriods[i]);
        expect(await dehubStaking.tierPercents(i)).to.be.equal(tierPercents[i]);
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
      const tierIndex = 0;
      await expect(doStake(stakerA, tierIndex, amount)).to.not.be.reverted;
    });

    it("Should stake multiple times in a reward period", async () => {
      const amount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      const count = 5;
      let totalAmount: BigNumber = BigNumber.from(0);
      for (let i = 0; i < count; ++i) {
        await doStake(stakerA, tierIndex, amount.mul(i + 1));
        totalAmount = totalAmount.add(amount.mul(i + 1));
      }

      const userStakedAmounts = await dehubStaking.userStakedAmounts(
        stakerA.address
      );
      expect(userStakedAmounts[0]).to.be.equal(totalAmount);

      const userInfo = await dehubStaking.userInfos(stakerA.address);
      expect(userInfo.totalAmount).to.be.equal(totalAmount);
    });

    it("Should stake multiple times on different tiers in a reward period", async () => {
      const amount = ethers.utils.parseEther("100");
      let totalAmount: BigNumber = BigNumber.from(0);
      for (let i = 0; i < tierPeriods.length; ++i) {
        await doStake(stakerA, i, amount.mul(i + 1));
        totalAmount = totalAmount.add(amount.mul(i + 1));
      }

      const userStakedAmounts = await dehubStaking.userStakedAmounts(
        stakerA.address
      );
      for (let i = 0; i < tierPeriods.length; ++i) {
        expect(userStakedAmounts[i]).to.be.equal(amount.mul(i + 1));
      }

      const userInfo = await dehubStaking.userInfos(stakerA.address);
      expect(userInfo.totalAmount).to.be.equal(totalAmount);
    });

    it("Multiple users should stake multiple times on different tiers in a reward period", async () => {
      const amount = ethers.utils.parseEther("100");
      const stakers = [stakerA, stakerB, stakerC];
      for (const staker of stakers) {
        let totalAmount: BigNumber = BigNumber.from(0);
        for (let i = 0; i < tierPeriods.length; ++i) {
          await doStake(staker, i, amount.mul(i + 1));
          totalAmount = totalAmount.add(amount.mul(i + 1));
        }

        const userStakedAmounts = await dehubStaking.userStakedAmounts(
          staker.address
        );
        for (let i = 0; i < tierPeriods.length; ++i) {
          expect(userStakedAmounts[i]).to.be.equal(amount.mul(i + 1));
        }

        const userInfo = await dehubStaking.userInfos(staker.address);
        expect(userInfo.totalAmount).to.be.equal(totalAmount);
      }
    });
  });

  describe("Unstake", async () => {
    it("Should revert calling unstake without stake", async () => {
      // Check if nothing staked till now
      const totalAmount = await totalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      await expect(
        dehubStaking.connect(stakerA).unstake(BigNumber.from(1))
      ).to.be.revertedWithCustomError(dehubStaking, "InvalidUnstakeAmount");
    });

    it("Should revert when unstake locked amount", async () => {
      const amount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, amount);

      await time.increase(tierPeriods[tierIndex] / 2);

      await expect(
        dehubStaking.connect(stakerA).unstake(amount)
      ).to.be.revertedWithCustomError(dehubStaking, "NotAvailableUnstake");
    });

    it("Should revert when unstake more than stake", async () => {
      const amount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, amount);

      await time.increase(tierPeriods[tierIndex]);

      await expect(
        dehubStaking.connect(stakerA).unstake(amount.mul(2))
      ).to.be.revertedWithCustomError(dehubStaking, "InvalidUnstakeAmount");
    });

    it("Should unstake amount staked on single tier", async () => {
      const amount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, amount);

      await time.increase(tierPeriods[tierIndex]);

      await expect(dehubStaking.connect(stakerA).unstake(amount)).to.be.not
        .reverted;
    });

    it("Should unstake amount multiple staked on single tier", async () => {
      const amount = ethers.utils.parseEther("100");
      const tierIndex = 0;

      const count = 5;
      let sumOfAmount = BigNumber.from(0);
      for (let i = 0; i < count; ++i) {
        await doStake(stakerA, tierIndex, amount.mul(i + 1));
        sumOfAmount = sumOfAmount.add(amount.mul(i + 1));
        await time.increase(10); // pass 10 second
      }

      expect(await totalStakedAmount(stakerA)).to.be.equal(sumOfAmount);

      await expect(
        dehubStaking.connect(stakerA).unstake(sumOfAmount)
      ).to.be.revertedWithCustomError(dehubStaking, "NotAvailableUnstake");
      await expect(
        dehubStaking.connect(stakerA).unstake(amount)
      ).to.be.revertedWithCustomError(dehubStaking, "NotAvailableUnstake");

      await time.increase(tierPeriods[tierIndex]);

      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      await expect(dehubStaking.connect(stakerA).unstake(sumOfAmount)).to.be.not
        .reverted;
      const balanceAfter = await dehubToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(sumOfAmount);
    });

    it("Should unstake amount staked on multiple tiers", async () => {
      const amount = ethers.utils.parseEther("100");

      const count = 5;
      let tierAmounts = new Array(tierPeriods.length).fill(BigNumber.from(0));
      let tierTimeEnd = 0,
        passed = 0;
      for (let i = 0; i < count; ++i) {
        const tierIndex = i % tierPeriods.length;
        await doStake(stakerA, tierIndex, amount.mul(i + 1));
        // Calculate total staked amount per each tier
        tierAmounts[tierIndex] = tierAmounts[tierIndex].add(amount.mul(i + 1));
        // Calculate longest expire time of locked amount
        const now = await time.latest();
        tierTimeEnd =
          tierTimeEnd > now + tierPeriods[tierIndex]
            ? tierTimeEnd
            : now + tierPeriods[tierIndex];
        await time.increase(10); // pass 10 second
        passed += 10;
      }

      const sumOfAmount = tierAmounts.reduce(
        (prev, current) => prev.add(current),
        BigNumber.from(0)
      );
      expect(await totalStakedAmount(stakerA)).to.be.equal(sumOfAmount);

      const userStakedAmounts = await dehubStaking.userStakedAmounts(
        stakerA.address
      );
      for (let i = 0; i < tierPeriods.length; ++i) {
        expect(userStakedAmounts[i]).to.be.equal(tierAmounts[i]);
      }

      await time.increaseTo(tierTimeEnd);

      await expect(dehubStaking.connect(stakerA).unstake(sumOfAmount)).to.be.not
        .reverted;
    });
  });

  describe("Pending Harvest", async () => {
    it("Should be zero before funding", async () => {
      // Check if nothing staked till now
      const totalAmount = await totalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      expect(pendingHarvest).to.be.equal(BigNumber.from(0));
    });

    it("Should have pending harvest after funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, stakeAmount);

      await time.increase(tierPeriods[tierIndex] / 2);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      const rewardAmount = fundAmount.mul(tierPercents[tierIndex]).div(10000);
      expect(pendingHarvest).to.be.equal(rewardAmount);
    });

    it("Should not be changed before funding again", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, stakeAmount);

      await time.increase(tierPeriods[tierIndex] / 2);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      const rewardAmount = fundAmount.mul(tierPercents[tierIndex]).div(10000);
      expect(pendingHarvest).to.be.equal(rewardAmount);

      await doStake(stakerA, tierIndex, stakeAmount);
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
        await doStake(stakers[i], tierIndex, stakeAmount);
      }

      await time.increase(
        tierPercents.reduce(
          (prev, current) => (prev > current ? prev : current),
          0
        )
      );

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      for (let i = 0; i < stakers.length; i++) {
        const pendingHarvest = await dehubStaking.pendingHarvest(
          stakers[i].address
        );
        expect(pendingHarvest).to.be.equal(
          fundAmount.mul(tierPercents[i]).div(10000)
        );
      }
    });

    it("Should be calculated depends on shares per tiers", async () => {
      const stakeAmountA = ethers.utils.parseEther("100");
      const stakeAmountB = ethers.utils.parseEther("200");
      const stakeAmountC = ethers.utils.parseEther("300");

      for (let i = 0; i < tierPeriods.length; ++i) {
        const tierIndex = i;
        await doStake(stakerA, tierIndex, stakeAmountA);
        await doStake(stakerB, tierIndex, stakeAmountB);
        await doStake(stakerC, tierIndex, stakeAmountC);
      }

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      const pendingHarvestA = await dehubStaking.pendingHarvest(
        stakerA.address
      );
      const pendingHarvestB = await dehubStaking.pendingHarvest(
        stakerB.address
      );
      const pendingHarvestC = await dehubStaking.pendingHarvest(
        stakerC.address
      );

      const tierRewards: BigNumber[] = [];
      for (let i = 0; i < tierPeriods.length; ++i) {
        tierRewards.push(fundAmount.mul(tierPercents[i]).div(10000));
      }
      const totalSupply = stakeAmountA.add(stakeAmountB).add(stakeAmountC);

      let claimableA: BigNumber = BigNumber.from(0);
      let claimableB: BigNumber = BigNumber.from(0);
      let claimableC: BigNumber = BigNumber.from(0);
      for (let i = 0; i < tierPeriods.length; ++i) {
        claimableA = claimableA.add(
          tierRewards[i].mul(stakeAmountA).div(totalSupply)
        );
        claimableB = claimableB.add(
          tierRewards[i].mul(stakeAmountB).div(totalSupply)
        );
        claimableC = claimableC.add(
          tierRewards[i].mul(stakeAmountC).div(totalSupply)
        );
      }

      expect(pendingHarvestA).to.be.equal(claimableA);
      expect(pendingHarvestB).to.be.equal(claimableB);
      expect(pendingHarvestC).to.be.equal(claimableC);
    });
  });

  describe("Claim", async () => {
    it("Should be reverted if claimable amount is zero", async () => {
      // Check if nothing staked till now
      const totalAmount = await totalStakedAmount(stakerA);
      expect(totalAmount).to.be.equal(BigNumber.from(0));

      await expect(
        dehubStaking.connect(stakerA).claim()
      ).to.be.revertedWithCustomError(dehubStaking, "ZeroHarvestAmount");
    });

    it("Should claim after funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, stakeAmount);

      await time.increase(tierPeriods[tierIndex]);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      const pendingHarvest = await dehubStaking.pendingHarvest(stakerA.address);
      const balanceBefore = await rewardToken.balanceOf(stakerA.address);
      await dehubStaking.connect(stakerA).claim();
      const balanceAfter = await rewardToken.balanceOf(stakerA.address);
      expect(balanceAfter.sub(balanceBefore)).to.be.equal(pendingHarvest);

      const userInfo = await dehubStaking.userInfos(stakerA.address);
      expect(userInfo.harvestClaimed).to.be.equal(pendingHarvest);
    });

    it("Should revert when claim again before second funding", async () => {
      const stakeAmount = ethers.utils.parseEther("100");
      const tierIndex = 0;
      await doStake(stakerA, tierIndex, stakeAmount);

      await time.increase(tierPeriods[tierIndex]);

      const fundAmount = ethers.utils.parseEther("1000");
      await doFund(fundAmount);

      await expect(dehubStaking.connect(stakerA).claim()).to.be.not.reverted;
      await expect(
        dehubStaking.connect(stakerA).claim()
      ).to.be.revertedWithCustomError(dehubStaking, "ZeroHarvestAmount");
    });

    it("Should claim multiple times", async () => {
      const tierIndex = 0;
      // Stake
      const stakeAmount1 = ethers.utils.parseEther("100");
      await doStake(stakerA, tierIndex, stakeAmount1);
      // Fund
      const fundAmount1 = ethers.utils.parseEther("1000");
      await doFund(fundAmount1);
      // Stake
      const stakeAmount2 = ethers.utils.parseEther("200");
      await doStake(stakerA, tierIndex, stakeAmount2);
      // Claim
      await dehubStaking.connect(stakerA).claim();
      // Fund
      const fundAmount2 = ethers.utils.parseEther("2000");
      await doFund(fundAmount2);
      // Claim
      await expect(dehubStaking.connect(stakerA).claim()).to.be.not.reverted;
      // Unstake all
      await time.increase(tierPeriods[tierIndex]);

      const balanceBefore = await dehubToken.balanceOf(stakerA.address);
      const userInfo = await dehubStaking.userInfos(stakerA.address);
      await dehubStaking.connect(stakerA).unstake(userInfo.totalAmount);
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
        await doStake(stakerA, tierIndex, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
        // Stake
        const stakeAmount2 = ethers.utils.parseEther("200");
        await doStake(stakerA, tierIndex, stakeAmount2);
        // Fund
        const fundAmount2 = ethers.utils.parseEther("2000");
        await doFund(fundAmount2);

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
        await doStake(stakerA, tierIndex, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
      });

      it("Should calculate pending harvest with snapshot of funding", async () => {
        const tierIndex = 0;
        // Stake
        const stakeAmount1 = ethers.utils.parseEther("100");
        await doStake(stakerA, tierIndex, stakeAmount1);
        // Fund
        const fundAmount1 = ethers.utils.parseEther("1000");
        await doFund(fundAmount1);
        const claimable1 = fundAmount1.mul(tierPercents[tierIndex]).div(10000);
        // Stake & Unstake
        const stakeAmount2 = ethers.utils.parseEther("200");
        await doStake(stakerA, tierIndex, stakeAmount2);
        await time.increase(tierPeriods[tierIndex]);
        await dehubStaking.connect(stakerA).unstake(stakeAmount2.div(4));
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
        const tierPeriodsA = [100, 200]; // in seconds
        const tierPercentsA = [5000, 5000]; // 100% in 10000
        await dehubStaking
          .connect(creator)
          .setTierPeriods(tierPeriodsA, tierPercentsA);

        const stakeAmount = ethers.utils.parseEther("100");
        const fundAmount = ethers.utils.parseEther("20");
        // Stake A,B,C
        await doStake(stakerA, 0, stakeAmount);
        await time.increase(tierPeriodsA[0] / 2);
        await doStake(stakerB, 1, stakeAmount);
        await time.increase(tierPeriodsA[0] / 2);
        await doStake(stakerC, 0, stakeAmount);
        await time.increase(tierPeriodsA[0]);
        // Fund
        await doFund(fundAmount);
        expect(await dehubStaking.pendingHarvest(stakerA.address)).to.be.equal(
          ethers.utils.parseEther("5")
        );
        expect(await dehubStaking.pendingHarvest(stakerB.address)).to.be.equal(
          ethers.utils.parseEther("10")
        );
        expect(await dehubStaking.pendingHarvest(stakerC.address)).to.be.equal(
          ethers.utils.parseEther("5")
        );
        // Stake A,B,C
        await doStake(stakerA, 1, stakeAmount);
        await time.increase(tierPeriodsA[0] / 2);
        await doStake(stakerC, 0, stakeAmount);
        await time.increase(tierPeriodsA[0] / 2);
        await doStake(stakerB, 0, stakeAmount);
        await time.increase(tierPeriodsA[0]);
        // Fund
        await doFund(fundAmount);
        expect(await dehubStaking.pendingHarvest(stakerA.address)).to.be.equal(
          ethers.utils.parseEther("15")
        );
        expect(await dehubStaking.pendingHarvest(stakerB.address)).to.be.equal(
          ethers.utils.parseEther("15")
        );
        expect(await dehubStaking.pendingHarvest(stakerC.address)).to.be.equal(
          ethers.utils.parseEther("10")
        );
        // Stake A,B,C
        await doStake(stakerC, 1, stakeAmount);
        await time.increase(tierPeriodsA[0] / 2);
        await doStake(stakerA, 0, stakeAmount);
        await doStake(stakerB, 0, stakeAmount);
        await time.increase(tierPeriodsA[0]);
        await doStake(stakerA, 0, stakeAmount);
        // Fund
        await doFund(fundAmount);

        const pendingHarvestA = await dehubStaking.pendingHarvest(
          stakerA.address
        );
        const pendingHarvestB = await dehubStaking.pendingHarvest(
          stakerB.address
        );
        const pendingHarvestC = await dehubStaking.pendingHarvest(
          stakerC.address
        );
        expect(pendingHarvestA).to.be.equal(
          ethers.utils.parseEther("15").add(fundAmount.div(3))
        );
        expect(pendingHarvestB).to.be.equal(
          ethers.utils.parseEther("15").add(fundAmount.div(6))
        );
        expect(pendingHarvestC).to.be.equal(ethers.utils.parseEther("20"));
      });
    });
  });
});
