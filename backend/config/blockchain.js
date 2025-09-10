const { ethers } = require('ethers');
require('dotenv').config();

// --- Validation ---
// Check for missing environment variables to prevent silent failures.
if (!process.env.BLOCKCHAIN_RPC_URL) {
  throw new Error("Missing BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.");
}
if (!process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error("Missing DEPLOYER_PRIVATE_KEY in .env file. Please provide the deployer's private key.");
}

const getProvider = () => {
  try {
    return new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  } catch (error) {
    console.error("Failed to connect to JSON-RPC provider:", error);
    // Re-throw the error to ensure the calling function knows about the failure.
    throw error;
  }
};

const getSigner = () => {
  try {
    const provider = getProvider();
    console.log("Creating signer from private key...");
    return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } catch (error) {
    console.error("Failed to create signer:", error);
    throw error;
  }
};

// Ensure your contract addresses are also present in the .env file
const contractAddresses = {
  invoiceFactory: process.env.INVOICE_FACTORY_ADDRESS,
  escrowContract: process.env.ESCROW_CONTRACT_ADDRESS,
  complianceManager: process.env.COMPLIANCE_MANAGER_ADDRESS,
};

module.exports = {
  getProvider,
  getSigner,
  contractAddresses,
};