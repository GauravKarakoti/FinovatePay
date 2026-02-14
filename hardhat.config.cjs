require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
          viaIR: true
        }
      },
      {
        version: "0.8.24",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
          viaIR: true
        }
      },
      {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 200 },
          viaIR: true
        }
      }
    ]
  },
  networks: {
    amoy: {
      // If the env variable is missing, use an empty string "" to prevent crashing
      url: process.env.ALCHEMY_AMOY_URL || "",
      // If the private key is missing, use an empty array []
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};
