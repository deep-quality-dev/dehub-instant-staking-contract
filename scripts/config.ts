type Network = "bsc" | "bscTestnet";

interface Config {
  dehubToken: string;
  rewardToken: string;
  rewardPeriod: number; // in seconds
  forceUnstakeFee: number; // percentage in 10000 as 100%
  minPeriod: number;
  periods: number[]; // in seconds
  percents: number[]; // percentage in 10000 as 100%
}

export const config: { [network in Network]: Config } = {
  bsc: {
    dehubToken: "0x680D3113caf77B61b510f332D5Ef4cf5b41A761D",
    rewardToken: "0x680D3113caf77B61b510f332D5Ef4cf5b41A761D",
    rewardPeriod: 2592000, // 30 days
    forceUnstakeFee: 1200,
    minPeriod: 7776000,
    periods: [7776000, 15552000, 31104000], // 1-2 quarter(180 days), 2-4 quarter(360 days), 4+ quarter
    percents: [2500, 2500, 5000],
  },
  bscTestnet: {
    dehubToken: "0xEad75F6d5E16E86b157937Ba227c13B5fb6864fC",
    rewardToken: "0xEad75F6d5E16E86b157937Ba227c13B5fb6864fC",
    rewardPeriod: 43200,
    forceUnstakeFee: 1200,
    minPeriod: 43200,
    periods: [43200, 86400, 172800],
    percents: [2500, 2500, 5000],
  },
};
