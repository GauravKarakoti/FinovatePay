const { ethers } = require("ethers");
require("dotenv").config();

// Import secrets provider for secure key management
const { getSecret } = require("../services/secrets");

// 1️⃣ Import ABIs and Deployed Addresses
const FractionTokenABI = require("../../deployed/FractionToken.json").abi;
const ComplianceManagerABI = require("../../deployed/ComplianceManager.json").abi;
const FinancingManagerABI = require("../../deployed/FinancingManager.json").interface.fragments;
const EscrowContractABI = require("../../deployed/EscrowContract.json").interface.fragments;
const TreasuryManagerABI = require("../../deployed/TreasuryManager.json").abi;
const deployedAddresses = require("../../deployed/contract-addresses.json");

// --------------------------------------------------
// Configuration Validation
// --------------------------------------------------

let configError = null;

// Async validation of configuration
const validateConfig = async () => {
  if (!process.env.BLOCKCHAIN_RPC_URL) {
    return "Missing BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.";
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

/**
 * Gets the signer using the private key from secrets provider.
 * Falls back to environment variable for backward compatibility.
 */
const getSigner = async () => {
  // Try to get private key from secrets provider first
  let privateKey = await getSecret("DEPLOYER_PRIVATE_KEY");
  
  // Fall back to environment variable
  if (!privateKey) {
    privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  }

  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY not configured. Set via secrets provider or environment variable.");
  }

  const provider = getProvider();

  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (error) {
    throw new Error(`Failed to create signer: ${error.message}`);
  }
};

/**
 * Synchronous version of getSigner for backward compatibility.
 * Uses environment variable only.
 * @deprecated Use async getSigner() instead
 */
const getSignerSync = () => {
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

  // Proxy Admin for upgrades
  proxyAdmin:
    deployedAddresses.ProxyAdmin ||
    process.env.PROXY_ADMIN_ADDRESS,

  // Multi-Sig Wallet
  multiSigWallet:
    deployedAddresses.MultiSigWallet ||
    process.env.MULTISIG_WALLET_ADDRESS,

  // Governance Contracts
  governanceToken:
    deployedAddresses.FinovateToken ||
    process.env.GOVENNANCE_TOKEN_ADDRESS,
  governanceManager:
    deployedAddresses.GovernanceManager ||
    process.env.GOVERNANCE_MANAGER_ADDRESS,
  timeLock:
    deployedAddresses.TimeLock ||
    process.env.TIMELOCK_ADDRESS,
  // Treasury manager (protocol treasury)
  treasuryManager:
    deployedAddresses.TreasuryManager ||
    process.env.TREASURY_MANAGER_ADDRESS,
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

const getTreasuryManagerContract = (signerOrProvider) =>
  createContract(
    contractAddresses.treasuryManager,
    TreasuryManagerABI,
    signerOrProvider,
    "TreasuryManager"
  );

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