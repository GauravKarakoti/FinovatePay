const { ethers } = require('ethers');
const { get } = require('../routes/chatbot');
require('dotenv').config();
// 1. Import the ABI
const FractionTokenABI = require('../../deployed/FractionToken.json').abi;
const ComplianceManagerABI = require('../../deployed/ComplianceManager.json').abi;
const FinancingManagerABI = require('../../deployed/FinancingManager.json').abi;

// --- Validation ---
if (!process.env.BLOCKCHAIN_RPC_URL) {
  throw new Error("Missing BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.");
}
if (!process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error("Missing DEPLOYER_PRIVATE_KEY in .env file. Please provide the deployer's private key.");
}
// 2. Add validation for the token address
if (!process.env.FRACTION_TOKEN_ADDRESS) {
  throw new Error("Missing FRACTION_TOKEN_ADDRESS in .env file.");
}

const getProvider = () => {
  try {
    return new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  } catch (error) {
    console.error("Failed to connect to JSON-RPC provider:", error);
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

// 3. Create a function to get the contract instance
/**
 * Gets an instance of the FractionToken contract.
 * @param {ethers.Signer | ethers.Provider} [signerOrProvider] - An ethers signer (for transactions) or provider (for read-only calls).
 * @returns {ethers.Contract}
 */
const getFractionTokenContract = (signerOrProvider) => {
  const provider = getProvider();
  return new ethers.Contract(
    process.env.FRACTION_TOKEN_ADDRESS,
    FractionTokenABI,
    signerOrProvider || provider // Use signer if provided, else fallback to provider
  );
};

const getComplianceManagerContract = (signerOrProvider) => {
  const provider = getProvider();
  return new ethers.Contract(
    process.env.COMPLIANCE_MANAGER_ADDRESS,
    ComplianceManagerABI,
    signerOrProvider || provider // Use signer if provided, else fallback to provider
  );
};

const getFinancingManagerContract = (signerOrProvider) => {
  const provider = getProvider();
  return new ethers.Contract(
    process.env.FINANCING_MANAGER_ADDRESS,
    FinancingManagerABI,
    signerOrProvider || provider // Use signer if provided, else fallback to provider
  );
};

const contractAddresses = {
  invoiceFactory: process.env.INVOICE_FACTORY_ADDRESS,
  escrowContract: process.env.ESCROW_CONTRACT_ADDRESS,
  complianceManager: process.env.COMPLIANCE_MANAGER_ADDRESS,
  produceTracking: process.env.PRODUCE_TRACKING_ADDRESS,
  fractionToken: process.env.FRACTION_TOKEN_ADDRESS,
  financingManager: process.env.FINANCING_MANAGER_ADDRESS
};

module.exports = {
  getProvider,
  getSigner,
  contractAddresses,
  getComplianceManagerContract,
  getFractionTokenContract,
  getFinancingManagerContract,
  FractionTokenABI
};