import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers, network, upgrades } from "hardhat";
import { DeHubStaking__factory } from "../typechain-types";
import { config } from "./config";
import { verifyContract } from "./helpers";

const main = async () => {
  const signers = await ethers.getSigners();
  if (signers.length < 1) {
    throw new Error(`Not found deployer`);
  }

  const deployer: SignerWithAddress = signers[0];
  console.log(`Using deployer address ${deployer.address}`);

  if (
    network.name === "goerli" ||
    // network.name === "hardhat" ||
    network.name === "mainnet"
  ) {
    const DeHubStakingFactory = new DeHubStaking__factory(deployer);
    const dehubStaking = await upgrades.deployProxy(
      DeHubStakingFactory,
      [
        config[network.name].dehub,
        config[network.name].reward,
        config[network.name].periods,
        config[network.name].percents,
      ],
      {
        kind: "uups",
        initializer: "__DeHubStaking_init",
      }
    );
    await dehubStaking.deployed();

    console.log(`DeHubStaking deployed at ${dehubStaking.address}`);

    const dehubStakingImpl = await upgrades.erc1967.getImplementationAddress(
      dehubStaking.address
    );
    await verifyContract(dehubStakingImpl);

    console.table([
      {
        Label: "Deployer",
        Info: deployer.address,
      },
      {
        Label: "DeHubStaking",
        Info: dehubStaking.address,
      },
      {
        Label: "DeHubStaking impl",
        Info: dehubStakingImpl,
      },
    ]);
  }
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
