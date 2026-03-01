const { ethers } = require("ethers");
require("dotenv").config();

// 1️⃣ Import ABIs and Deployed Addresses
const FractionTokenABI = require("../../deployed/FractionToken.json").abi;
const ComplianceManagerABI = require("../../deployed/ComplianceManager.json").abi;
const FinancingManagerABI = require("../../deployed/FinancingManager.json").abi;
const EscrowContractABI = require("../../deployed/EscrowContract.json").abi;
const deployedAddresses = require("../../deployed/contract-addresses.json");

// --------------------------------------------------
// Configuration Validation
// --------------------------------------------------

let configError = null;

if (!process.env.BLOCKCHAIN_RPC_URL) {
  configError =
    "Missing BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.";
}

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  configError =
    configError ||
    "Missing DEPLOYER_PRIVATE_KEY in .env file. Please provide the deployer's private key.";
}

const getConfigError = () => configError;

// --------------------------------------------------
// Provider & Signer (Fail-Fast)
// --------------------------------------------------

const getProvider = () => {
  if (!process.env.BLOCKCHAIN_RPC_URL) {
    throw new Error("BLOCKCHAIN_RPC_URL not configured.");
  }

  try {
    return new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  } catch (error) {
    throw new Error(
      `Failed to create JSON-RPC provider: ${error.message}`
    );
  }
};

const getSigner = () => {
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY not configured.");
  }

  const provider = getProvider();

  try {
    return new ethers.Wallet(
      process.env.DEPLOYER_PRIVATE_KEY,
      provider
    );
  } catch (error) {
    throw new Error(`Failed to create signer: ${error.message}`);
  }
};

// --------------------------------------------------
// Centralized Contract Addresses
// Priority: JSON File > Env Vars
// --------------------------------------------------

const contractAddresses = {
  invoiceFactory:
    deployedAddresses.InvoiceFactory ||
    process.env.INVOICE_FACTORY_ADDRESS,

  escrowContract:
    deployedAddresses.EscrowContract ||
    process.env.ESCROW_CONTRACT_ADDRESS,

  complianceManager:
    deployedAddresses.ComplianceManager ||
    process.env.COMPLIANCE_MANAGER_ADDRESS,

  produceTracking:
    deployedAddresses.ProduceTracking ||
    process.env.PRODUCE_TRACKING_ADDRESS,

  fractionToken:
    deployedAddresses.FractionToken ||
    process.env.FRACTION_TOKEN_ADDRESS,

  financingManager:
    deployedAddresses.FinancingManager ||
    process.env.FINANCING_MANAGER_ADDRESS,
};

// --------------------------------------------------
// Contract Getter Utility
// --------------------------------------------------

const createContract = (address, abi, signerOrProvider, contractName) => {
  if (!address) {
    throw new Error(`${contractName} contract address is not configured.`);
  }

  const provider = signerOrProvider || getProvider();

  if (!provider) {
    throw new Error("Blockchain provider is not available.");
  }

  try {
    return new ethers.Contract(address, abi, provider);
  } catch (error) {
    throw new Error(
      `Failed to initialize ${contractName} contract: ${error.message}`
    );
  }
};

// --------------------------------------------------
// Contract Instance Getters
// --------------------------------------------------

const getFractionTokenContract = (signerOrProvider) =>
  createContract(
    contractAddresses.fractionToken,
    FractionTokenABI,
    signerOrProvider,
    "FractionToken"
  );

const getComplianceManagerContract = (signerOrProvider) =>
  createContract(
    contractAddresses.complianceManager,
    ComplianceManagerABI,
    signerOrProvider,
    "ComplianceManager"
  );

const getFinancingManagerContract = (signerOrProvider) =>
  createContract(
    contractAddresses.financingManager,
    FinancingManagerABI,
    signerOrProvider,
    "FinancingManager"
  );

const getEscrowContract = (signerOrProvider) =>
  createContract(
    contractAddresses.escrowContract,
    EscrowContractABI,
    signerOrProvider,
    "EscrowContract"
  );

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  getProvider,
  getSigner,
  contractAddresses,
  getComplianceManagerContract,
  getFractionTokenContract,
  getFinancingManagerContract,
  getEscrowContract,
  getConfigError,
  FractionTokenABI,
  EscrowContractABI,
};