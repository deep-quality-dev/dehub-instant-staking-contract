type Network = "bsc" | "bscTestnet";

interface Config {
  dehubToken: string;
  rewardToken: string;
  rewardPeriod: number; // in seconds
  forceUnstakeFee: number; // percentage in 10000 as 100%
  periods: number[]; // in seconds
  percents: number[]; // percentage in 10000 as 100%
}

export const config: { [network in Network]: Config } = {
  bsc: {
    dehubToken: "",
    rewardToken: "",
    rewardPeriod: 0,
    forceUnstakeFee: 0,
    periods: [],
    percents: [2500, 2500, 5000],
  },
  bscTestnet: {
    dehubToken: "0xEad75F6d5E16E86b157937Ba227c13B5fb6864fC",
    rewardToken: "0xEad75F6d5E16E86b157937Ba227c13B5fb6864fC",
    rewardPeriod: 43200,
    forceUnstakeFee: 0,
    periods: [43200, 86400, 172800],
    percents: [2500, 2500, 5000],
  },
};
