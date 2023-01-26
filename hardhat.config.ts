import * as dotenv from "dotenv";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";

dotenv.config();

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      TESTNET_PRIVATE_KEY: string;
      MAINNET_PRIVATE_KEY: string;
      
      BSCSCAN_API_KEY: string;
    }
  }
}

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.17",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    ],
  },
  networks: {
    bsc: {
      url: `https://bsc-dataseed.binance.org`,
      accounts: [process.env.MAINNET_PRIVATE_KEY],
    },
    bscTestnet: {
      url: `https://bsc-testnet.public.blastapi.io`,
      accounts: [process.env.TESTNET_PRIVATE_KEY],
    },
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY,
      bscTestnet: process.env.BSCSCAN_API_KEY,
    },
  },
};

export default config;
