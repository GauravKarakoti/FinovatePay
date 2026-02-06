require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    amoy: {
      url: process.env.ALCHEMY_AMOY_URL,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
