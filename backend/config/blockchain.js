const { ethers } = require('ethers');
require('dotenv').config();

// 1. Import ABIs and Deployed Addresses
const FractionTokenABI = require('../../deployed/FractionToken.json').abi;
const ComplianceManagerABI = require('../../deployed/ComplianceManager.json').abi;
const FinancingManagerABI = require('../../deployed/FinancingManager.json').abi;
const EscrowContractABI = require('../../deployed/EscrowContract.json').abi;
const deployedAddresses = require('../../deployed/contract-addresses.json');

// --- Validation with graceful error handling ---
let configError = null;

if (!process.env.BLOCKCHAIN_RPC_URL) {
  configError = "Missing BLOCKCHAIN_RPC_URL in .env file. Please provide a valid RPC URL.";
  console.error(`[Blockchain Config] ${configError}`);
}

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  configError = configError || "Missing DEPLOYER_PRIVATE_KEY in .env file. Please provide the deployer's private key.";
  console.error(`[Blockchain Config] ${configError}`);
}

/**
 * Get configuration error if any
 * @returns {string|null} Error message or null if config is valid
 */
const getConfigError = () => configError;


const getProvider = () => {
  try {
    if (!process.env.BLOCKCHAIN_RPC_URL) {
      throw new Error('BLOCKCHAIN_RPC_URL not configured');
    }
    return new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  } catch (error) {
    console.error("[Blockchain] Failed to create JSON-RPC provider:", error.message);
    // Return null instead of throwing to prevent server crash
    return null;
  }
};


const getSigner = () => {
  try {
    if (!process.env.DEPLOYER_PRIVATE_KEY) {
      throw new Error('DEPLOYER_PRIVATE_KEY not configured');
    }
    
    const provider = getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    return new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } catch (error) {
    console.error("[Blockchain] Failed to create signer:", error.message);
    // Return null instead of throwing to prevent server crash
    return null;
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

// 3. Contract Instance Getters with error handling
const getFractionTokenContract = (signerOrProvider) => {
  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    if (!contractAddresses.fractionToken) {
      throw new Error('FractionToken address not configured');
    }
    
    return new ethers.Contract(
      contractAddresses.fractionToken,
      FractionTokenABI,
      provider
    );
  } catch (error) {
    console.error("[Blockchain] Failed to get FractionToken contract:", error.message);
    return null;
  }
};

const getComplianceManagerContract = (signerOrProvider) => {
  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    if (!contractAddresses.complianceManager) {
      throw new Error('ComplianceManager address not configured');
    }
    
    return new ethers.Contract(
      contractAddresses.complianceManager,
      ComplianceManagerABI,
      provider
    );
  } catch (error) {
    console.error("[Blockchain] Failed to get ComplianceManager contract:", error.message);
    return null;
  }
};

const getFinancingManagerContract = (signerOrProvider) => {
  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    if (!contractAddresses.financingManager) {
      throw new Error('FinancingManager address not configured');
    }
    
    return new ethers.Contract(
      contractAddresses.financingManager,
      FinancingManagerABI,
      provider
    );
  } catch (error) {
    console.error("[Blockchain] Failed to get FinancingManager contract:", error.message);
    return null;
  }
};

const getEscrowContract = (signerOrProvider) => {
  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }
    
    if (!contractAddresses.escrowContract) {
      throw new Error('EscrowContract address not configured');
    }
    
    return new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractABI,
      provider
    );
  } catch (error) {
    console.error("[Blockchain] Failed to get EscrowContract:", error.message);
    return null;
  }
};


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
  EscrowContractABI
};
