require("@nomiclabs/hardhat-waffle");
require("dotenv").config();

const config = {
    solidity: "0.8.20",
    networks: {}
};

if (process.env.ALCHEMY_AMOY_URL && process.env.PRIVATE_KEY) {
    config.networks.amoy = {
        url: process.env.ALCHEMY_AMOY_URL,
        accounts: [process.env.PRIVATE_KEY]
    };
}

module.exports = config;
