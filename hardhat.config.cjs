require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

module.exports = {
    solidity: "0.8.20",
    networks: {
        amoy: {
            url: process.env.ALCHEMY_AMOY_URL,
            accounts: [process.env.PRIVATE_KEY]
        }
    }
};