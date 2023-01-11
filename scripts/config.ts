type Network = "mainnet" | "goerli";

interface Config {
  dehub: string;
  reward: string;
  periods: number[]; // block count
  percents: number[]; // percentage in 10000 as 100%
}

export const config: { [network in Network]: Config } = {
  mainnet: {
    dehub: "",
    reward: "",
    periods: [],
    percents: [],
  },
  goerli: {
    dehub: "",
    reward: "",
    periods: [],
    percents: [],
  },
};
