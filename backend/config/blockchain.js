const { ethers } = require('ethers');
require('dotenv').config();

// 1. Import ABIs and Deployed Addresses
const FractionTokenABI = require('../../deployed/FractionToken.json').abi;
const ComplianceManagerABI = require('../../deployed/ComplianceManager.json').abi;
const FinancingManagerABI = require('../../deployed/FinancingManager.json').abi;
const deployedAddresses = require('../../deployed/contract-addresses.json');

// --- Validation ---
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
    throw error;
  }
};

const getSigner = () => {
  try {
    const provider = getProvider();
    return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } catch (error) {
    console.error("Failed to create signer:", error);
    throw error;
  }
};

// 2. Centralized Contract Addresses (Priority: JSON File > Env Vars)
const contractAddresses = {
  invoiceFactory: deployedAddresses.InvoiceFactory || process.env.INVOICE_FACTORY_ADDRESS,
  escrowContract: deployedAddresses.EscrowContract || process.env.ESCROW_CONTRACT_ADDRESS,
  complianceManager: deployedAddresses.ComplianceManager || process.env.COMPLIANCE_MANAGER_ADDRESS,
  produceTracking: deployedAddresses.ProduceTracking || process.env.PRODUCE_TRACKING_ADDRESS,
  fractionToken: deployedAddresses.FractionToken || process.env.FRACTION_TOKEN_ADDRESS,
  financingManager: deployedAddresses.FinancingManager || process.env.FINANCING_MANAGER_ADDRESS
};

// 3. Contract Instance Getters
const getFractionTokenContract = (signerOrProvider) => {
  if (!contractAddresses.fractionToken) {
    throw new Error("FractionToken contract address is not configured.");
  }

  try {
    const provider = getProvider();
    return new ethers.Contract(
      contractAddresses.fractionToken,
      FractionTokenABI,
      signerOrProvider || provider
    );
  } catch (error) {
    throw new Error(`Failed to initialize FractionToken contract: ${error.message}`);
  }
};

const getComplianceManagerContract = (signerOrProvider) => {
  if (!contractAddresses.complianceManager) {
    throw new Error("ComplianceManager contract address is not configured.");
  }

  try {
    const provider = getProvider();
    return new ethers.Contract(
      contractAddresses.complianceManager,
      ComplianceManagerABI,
      signerOrProvider || provider
    );
  } catch (error) {
    throw new Error(`Failed to initialize ComplianceManager contract: ${error.message}`);
  }
};

const getFinancingManagerContract = (signerOrProvider) => {
  if (!contractAddresses.financingManager) {
    throw new Error("FinancingManager contract address is not configured.");
  }

  try {
    const provider = getProvider();
    return new ethers.Contract(
      contractAddresses.financingManager,
      FinancingManagerABI,
      signerOrProvider || provider
    );
  } catch (error) {
    throw new Error(`Failed to initialize FinancingManager contract: ${error.message}`);
  }
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