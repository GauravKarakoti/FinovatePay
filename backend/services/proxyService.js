/**
 * Proxy Service - Handles upgradeable proxy contract operations
 * @author FinovatePay Team
 * @description Manages UUPS proxy deployments, upgrades, and tracking via standard OpenZeppelin patterns
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { getSigner, contractAddresses } = require('../config/blockchain');
const { errorResponse } = require('../utils/errorResponse');

// Standard UUPS Upgradeable ABI for proxy interaction
const UUPS_ABI = [
  'function upgradeToAndCall(address newImplementation, bytes data) payable',
  'function upgradeTo(address newImplementation)'
];

// EIP-1967 implementation storage slot: bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

/**
 * Get a generic proxy contract instance using the UUPS interface
 */
const getProxyContract = (proxyAddress, signer) => {
  return new ethers.Contract(proxyAddress, UUPS_ABI, signer || getSigner());
};

/**
 * Deploy a new proxy contract (ERC1967Proxy)
 * @param {string} contractName - Name of the contract (e.g., 'EscrowContractV2')
 * @param {string} implementationAddress - Address of the implementation contract
 * @param {string} adminAddress - Address that will be admin of the proxy (Not used directly in UUPS, kept for DB tracking)
 * @param {number} version - Initial version number
 * @param {object} initData - Initialization data for the proxy (encoded function call)
 * @param {string} deployerAddress - Address of the deployer
 * @returns {object} - Deployment result with transaction details
 */
const deployProxy = async (contractName, implementationAddress, adminAddress, version, initData, deployerAddress) => {
  const client = await pool.connect();
  
  try {
    const signer = getSigner();
    
    // Load the standard OpenZeppelin ERC1967Proxy artifact deployed during setup
    const artifactPath = path.join(__dirname, '../../deployed/ERC1967Proxy.json');
    if (!fs.existsSync(artifactPath)) {
      throw new Error("ERC1967Proxy artifact not found. Make sure you ran the deployment script first.");
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    
    // Create Contract Factory to deploy the Proxy
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
    
    // Deploy the proxy pointing to the implementation address
    const proxy = await factory.deploy(
      implementationAddress,
      initData || '0x'
    );
    
    await proxy.waitForDeployment();
    const receipt = await proxy.deploymentTransaction().wait();
    
    const proxyAddress = proxy.target;
    
    // Store in database
    await client.query('BEGIN');
    
    await client.query(
      `INSERT INTO proxy_contracts 
        (contract_name, proxy_address, implementation_address, deployer_address, admin_address, version, is_active, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (contract_name) DO UPDATE SET
        proxy_address = $2,
        implementation_address = $3,
        version = $6,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP`,
      [contractName, proxyAddress, implementationAddress, deployerAddress, adminAddress, version, true, JSON.stringify({ deploymentTx: receipt.hash })]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      contractName,
      proxyAddress,
      implementationAddress,
      version,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deploying proxy:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Upgrade an existing proxy to a new implementation using UUPS upgradeToAndCall
 * @param {string} proxyAddress - Address of the proxy to upgrade
 * @param {string} newImplementationAddress - Address of the new implementation
 * @param {number} newVersion - New version number
 * @param {string} reason - Reason for the upgrade
 * @returns {object} - Upgrade result
 */
const upgradeProxy = async (proxyAddress, newImplementationAddress, newVersion, reason) => {
  const client = await pool.connect();
  
  try {
    const signer = getSigner();
    
    // Get current implementation before upgrade by reading the storage slot
    const oldImplementation = await getCurrentImplementation(proxyAddress);
    
    // Get contract name from database
    const contractResult = await client.query(
      'SELECT contract_name, version FROM proxy_contracts WHERE proxy_address = $1',
      [proxyAddress]
    );
    
    if (contractResult.rows.length === 0) {
      throw new Error('Proxy not found in database');
    }
    
    const contractName = contractResult.rows[0].contract_name;
    const previousVersion = contractResult.rows[0].version;
    
    // Perform the upgrade directly on the Proxy (UUPS pattern)
    const proxyContract = getProxyContract(proxyAddress, signer);
    const tx = await proxyContract.upgradeToAndCall(newImplementationAddress, "0x");
    const receipt = await tx.wait();
    
    // Store upgrade in database
    await client.query('BEGIN');
    
    await client.query(
      `INSERT INTO proxy_upgrade_history 
        (proxy_address, contract_name, old_implementation, new_implementation, previous_version, new_version, upgraded_by, upgrade_reason, tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        proxyAddress,
        contractName,
        oldImplementation,
        newImplementationAddress,
        previousVersion,
        newVersion,
        signer.address,
        reason,
        tx.hash
      ]
    );
    
    // Update the proxy contract record
    await client.query(
      `UPDATE proxy_contracts 
       SET implementation_address = $1, version = $2, updated_at = CURRENT_TIMESTAMP
       WHERE proxy_address = $3`,
      [newImplementationAddress, newVersion, proxyAddress]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      proxyAddress,
      contractName,
      oldImplementation,
      newImplementationAddress,
      previousVersion,
      newVersion,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error upgrading proxy:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get proxy information from database
 * @param {string} contractName - Name of the contract
 * @returns {object} - Proxy information
 */
const getProxyInfo = async (contractName) => {
  try {
    const result = await pool.query(
      'SELECT * FROM proxy_contracts WHERE contract_name = $1',
      [contractName]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error getting proxy info:', error);
    throw error;
  }
};

/**
 * Get all proxy contracts
 * @param {boolean} activeOnly - Only return active proxies
 * @returns {array} - Array of proxy contracts
 */
const getAllProxies = async (activeOnly = false) => {
  try {
    let query = 'SELECT * FROM proxy_contracts';
    if (activeOnly) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY deployed_at DESC';
    
    const result = await pool.query(query);
    return result.rows;
  } catch (error) {
    console.error('Error getting all proxies:', error);
    throw error;
  }
};

/**
 * Get upgrade history for a proxy
 * @param {string} proxyAddress - Address of the proxy
 * @returns {array} - Array of upgrade records
 */
const getUpgradeHistory = async (proxyAddress) => {
  try {
    const result = await pool.query(
      `SELECT * FROM proxy_upgrade_history 
       WHERE proxy_address = $1 
       ORDER BY upgraded_at DESC`,
      [proxyAddress]
    );
    
    return result.rows;
  } catch (error) {
    console.error('Error getting upgrade history:', error);
    throw error;
  }
};

/**
 * Get current implementation address from blockchain directly via the EIP-1967 storage slot
 * @param {string} proxyAddress - Address of the proxy
 * @returns {string} - Current implementation address
 */
const getCurrentImplementation = async (proxyAddress) => {
  try {
    const provider = getSigner().provider;
    // Read the specific EIP-1967 storage slot for the proxy's implementation
    const storageValue = await provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT);
    
    // If empty slot, return the Zero Address
    if (storageValue === '0x' || storageValue === '0x0') {
      return ethers.ZeroAddress;
    }
    
    // Parse the 20-byte address from the 32-byte storage slot
    return ethers.getAddress("0x" + storageValue.slice(-40));
  } catch (error) {
    console.error('Error getting current implementation:', error);
    throw error;
  }
};

/**
 * Verify proxy implementation matches database
 * @param {string} contractName - Name of the contract
 * @returns {object} - Verification result
 */
const verifyProxyIntegrity = async (contractName) => {
  try {
    const dbInfo = await getProxyInfo(contractName);
    
    if (!dbInfo) {
      return {
        verified: false,
        contractName,
        reason: 'Proxy not found in database'
      };
    }
    
    const onChainImplementation = await getCurrentImplementation(dbInfo.proxy_address);
    
    const isVerified = onChainImplementation.toLowerCase() === dbInfo.implementation_address.toLowerCase();
    
    return {
      verified: isVerified,
      contractName,
      dbImplementation: dbInfo.implementation_address,
      onChainImplementation,
      proxyAddress: dbInfo.proxy_address,
      version: dbInfo.version,
      isActive: dbInfo.is_active
    };
  } catch (error) {
    console.error('Error verifying proxy integrity:', error);
    throw error;
  }
};

/**
 * Pause a proxy (deactivate) in the database
 * @param {string} contractName - Name of the contract
 * @returns {object} - Result
 */
const pauseProxy = async (contractName) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const result = await client.query(
      `UPDATE proxy_contracts 
       SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE contract_name = $1
       RETURNING *`,
      [contractName]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Proxy not found');
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      contractName,
      isActive: false
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error pausing proxy:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Unpause a proxy (reactivate) in the database
 * @param {string} contractName - Name of the contract
 * @returns {object} - Result
 */
const unpauseProxy = async (contractName) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const result = await client.query(
      `UPDATE proxy_contracts 
       SET is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE contract_name = $1
       RETURNING *`,
      [contractName]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Proxy not found');
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      contractName,
      isActive: true
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error unpausing proxy:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get deployment statistics
 * @returns {object} - Statistics
 */
const getProxyStats = async () => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM proxy_contracts');
    const activeResult = await pool.query('SELECT COUNT(*) as active FROM proxy_contracts WHERE is_active = true');
    const upgradesResult = await pool.query('SELECT COUNT(*) as total_upgrades FROM proxy_upgrade_history');
    
    return {
      totalProxies: parseInt(totalResult.rows[0].total),
      activeProxies: parseInt(activeResult.rows[0].active),
      totalUpgrades: parseInt(upgradesResult.rows[0].total_upgrades)
    };
  } catch (error) {
    console.error('Error getting proxy stats:', error);
    throw error;
  }
};

module.exports = {
  deployProxy,
  upgradeProxy,
  getProxyInfo,
  getAllProxies,
  getUpgradeHistory,
  getCurrentImplementation,
  verifyProxyIntegrity,
  pauseProxy,
  unpauseProxy,
  getProxyStats,
  getProxyContract
};
