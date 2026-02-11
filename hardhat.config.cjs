require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.20",
  networks: {
    amoy: {
      // If the env variable is missing, use an empty string "" to prevent crashing
      url: process.env.ALCHEMY_AMOY_URL || "",
      // If the private key is missing, use an empty array []
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
};