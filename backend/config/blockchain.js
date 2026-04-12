const { ethers } = require("ethers");
require("dotenv").config();

// Import secrets provider for secure key management
const { getSecret } = require("../services/secrets");

// Helper to extract ABI safely whether it's a Hardhat Artifact or an ethers.js Contract dump
const extractAbi = (artifact) => {
  return artifact.abi || (artifact.interface && artifact.interface.fragments) || artifact;
};

// 1️⃣ Import ABIs and Deployed Addresses
const FractionTokenABI = extractAbi(require("../../deployed/FractionToken.json"));
const ComplianceManagerABI = extractAbi(require("../../deployed/ComplianceManager.json"));
const FinancingManagerABI = extractAbi(require("../../deployed/FinancingManager.json"));
const EscrowContractABI = extractAbi(require("../../deployed/EscrowContract.json"));
const TreasuryManagerABI = extractAbi(require("../../deployed/TreasuryManager.json"));
const deployedAddresses = require("../../deployed/contract-addresses.json");

// Async validation of configuration
const validateConfig = async () => {
  const rpcUrl = process.env.WS_RPC_URL || process.env.BLOCKCHAIN_RPC_URL;
  if (!rpcUrl) {
    return "Missing WS_RPC_URL or BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.";
  }

  // Check for private key in secrets provider or env
  const privateKey = await getSecret("DEPLOYER_PRIVATE_KEY");
  if (!privateKey && !process.env.DEPLOYER_PRIVATE_KEY) {
    return "Missing DEPLOYER_PRIVATE_KEY. Please configure via secrets provider or environment variable.";
  }

  return null;
};

// Initialize config validation
let _configError = null;
validateConfig().then(err => {
  _configError = err;
});

const getConfigError = () => _configError;

// --------------------------------------------------
// Provider & Signer (Singletons to prevent Rate Limits)
// --------------------------------------------------

let cachedProvider = null;
let cachedSignerPromise = null;
let cachedSignerSync = null;

const getProvider = () => {
  if (cachedProvider) return cachedProvider;

  const rpcUrl = process.env.WS_RPC_URL || process.env.BLOCKCHAIN_RPC_URL;

  if (!rpcUrl) {
    throw new Error("RPC URL not configured. Set WS_RPC_URL or BLOCKCHAIN_RPC_URL.");
  }

  try {
    if (rpcUrl.startsWith("ws://") || rpcUrl.startsWith("wss://")) {
      console.log("✅ Using WebSocketProvider");
      cachedProvider = new ethers.WebSocketProvider(rpcUrl);
    } else {
      console.log("⚠️ Using JsonRpcProvider (THIS WILL CAUSE FILTER ERRORS)");
      cachedProvider = new ethers.JsonRpcProvider(rpcUrl);
    }
    return cachedProvider;
  } catch (error) {
    throw new Error(`Failed to create provider: ${error.message}`);
  }
};

/**
 * Gets the signer using the private key from secrets provider.
 * Falls back to environment variable for backward compatibility.
 */
const getSigner = async () => {
  if (cachedSignerPromise) return cachedSignerPromise;

  cachedSignerPromise = (async () => {
    let privateKey = await getSecret("DEPLOYER_PRIVATE_KEY");
    
    if (!privateKey) {
      privateKey = process.env.DEPLOYER_PRIVATE_KEY;
    }

    if (!privateKey) {
      throw new Error("DEPLOYER_PRIVATE_KEY not configured. Set via secrets provider or environment variable.");
    }

    const provider = getProvider();
    return new ethers.Wallet(privateKey, provider);
  })();

  return cachedSignerPromise;
};

/**
 * Synchronous version of getSigner for backward compatibility.
 * @deprecated Use async getSigner() instead
 */
const getSignerSync = () => {
  if (cachedSignerSync) return cachedSignerSync;

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error("DEPLOYER_PRIVATE_KEY not configured.");
  }

  const provider = getProvider();

  try {
    cachedSignerSync = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
    return cachedSignerSync;
  } catch (error) {
    throw new Error(`Failed to create signer: ${error.message}`);
  }
};

// --------------------------------------------------
// Centralized Contract Addresses
// Priority: JSON File > Env Vars
// --------------------------------------------------

const contractAddresses = {
  invoiceFactory: deployedAddresses.InvoiceFactory,
  escrowContract: deployedAddresses.EscrowContractProxy,
  complianceManager: deployedAddresses.ComplianceManager,
  produceTracking: deployedAddresses.ProduceTracking,
  fractionToken: deployedAddresses.FractionToken,
  financingManager: deployedAddresses.FinancingManagerProxy,
  governanceToken: deployedAddresses.FinovateToken,
  treasuryManager: deployedAddresses.TreasuryManager
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
    throw new Error(`Failed to initialize ${contractName} contract: ${error.message}`);
  }
};

// --------------------------------------------------
// Contract Instance Getters
// --------------------------------------------------

const getFractionTokenContract = (signerOrProvider) =>
  createContract(contractAddresses.fractionToken, FractionTokenABI, signerOrProvider, "FractionToken");

const getComplianceManagerContract = (signerOrProvider) =>
  createContract(contractAddresses.complianceManager, ComplianceManagerABI, signerOrProvider, "ComplianceManager");

const getFinancingManagerContract = (signerOrProvider) =>
  createContract(contractAddresses.financingManager, FinancingManagerABI, signerOrProvider, "FinancingManager");

const getEscrowContract = (signerOrProvider) =>
  createContract(contractAddresses.escrowContract, EscrowContractABI, signerOrProvider, "EscrowContract");

const getTreasuryManagerContract = (signerOrProvider) =>
  createContract(contractAddresses.treasuryManager, TreasuryManagerABI, signerOrProvider, "TreasuryManager");

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  getProvider,
  getSigner,
  getSignerSync,
  contractAddresses,
  getComplianceManagerContract,
  getFractionTokenContract,
  getFinancingManagerContract,
  getEscrowContract,
  getTreasuryManagerContract,
  getConfigError,
  FractionTokenABI,
  EscrowContractABI,
  TreasuryManagerABI,
};