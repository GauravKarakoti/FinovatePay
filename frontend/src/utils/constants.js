import { ethers } from 'ethers';

// Synchronized with web3.js and Polygon Amoy deployments
export const TOKEN_ADDRESSES = {
    "USDC": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", // Amoy USDC
    "EURC": "0x1aBaEA1f7C830bD89Acc67Ec4af516284b1BC33c", // Amoy EURC
    "BRLC": "0x6DEf515A0419D4613c7A3950796339A4405d4191", // Amoy BRLC
    "DAI": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",   // Legacy/Other
};

export const NATIVE_CURRENCY_ADDRESS = ethers.ZeroAddress;