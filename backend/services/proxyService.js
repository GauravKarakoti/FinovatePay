/**
 * Proxy Service - Handles upgradeable proxy contract operations
 * @author FinovatePay Team
 * @description Manages UUPS proxy deployments, upgrades, and tracking
 */

const { ethers } = require('ethers');
const { pool } = require('../config/database');
const { getSigner, contractAddresses } = require('../config/blockchain');
const errorResponse = require('../utils/errorResponse');

// ABI fragments needed for proxy operations
const ERC1967_PROXY_ABI = [
  'function implementation() view returns (address)',
  'function upgradeToAndCall(address newImplementation, bytes data) payable',
  'function upgradeTo(address newImplementation)'
];

const PROXY_DEPLOYER_ABI = [
  'function deployProxy(address _implementation, string _contractName, address _admin, uint256 _version, bytes _data) returns (address)',
  'function upgradeProxy(address _proxyAddress, address _newImplementation, uint256 _newVersion, string _reason)',
  'function getProxyInfo(string _contractName) view returns (tuple(address proxyAddress, address implementationAddress, string contractName, uint256 version, address admin, bool isActive, uint256 deployedAt))',
  'function getLatestProxy(string _contractName) view returns (address)',
  'function getUpgradeHistory(address _proxyAddress) view returns (tuple(address proxyAddress, address oldImplementation, address newImplementation, uint256 newVersion, address upgradedBy, uint256 upgradedAt, string reason)[])'
];

/**
 * Get the ProxyDeployer contract instance
 */
const getProxyDeployerContract = (signer) => {
  const address = contractAddresses.proxyDeployer;
  if (!address) {
    throw new Error('ProxyDeployer address not configured');
  }
  return new ethers.Contract(address, PROXY_DEPLOYER_ABI, signer || getSigner());
};

/**
 * Get a generic proxy contract instance
 */
const getProxyContract = (proxyAddress, signer) => {
  return new ethers.Contract(proxyAddress, ERC1967_PROXY_ABI, signer || getSigner());
};

/**
 * Deploy a new proxy contract
 * @param {string} contractName - Name of the contract (e.g., 'EscrowContractV2')
 * @param {string} implementationAddress - Address of the implementation contract
 * @param {string} adminAddress - Address that will be admin of the proxy
 * @param {number} version - Initial version number
 * @param {object} initData - Initialization data for the proxy (encoded function call)
 * @param {string} deployerAddress - Address of the deployer
 * @returns {object} - Deployment result with transaction details
 */
const deployProxy = async (contractName, implementationAddress, adminAddress, version, initData, deployerAddress) => {
  const client = await pool.connect();
  
  try {
    const signer = getSigner();
    const proxyDeployer = getProxyDeployerContract(signer);
    
    // Deploy the proxy
    const tx = await proxyDeployer.deployProxy(
      implementationAddress,
      contractName,
      adminAddress,
      version,
      initData || '0x'
    );
    
    const receipt = await tx.wait();
    
    // Find the proxy address from the logs
    const proxyDeployedEvent = receipt.logs.find(log => {
      try {
        const parsed = proxyDeployer.interface.parseLog(log);
        return parsed?.name === 'ProxyDeployed';
      } catch {
        return false;
      }
    });
    
    let proxyAddress;
    if (proxyDeployedEvent) {
      const parsed = proxyDeployer.interface.parseLog(proxyDeployedEvent);
      proxyAddress = parsed.args.proxyAddress;
    } else {
      // Fallback: get the proxy address from the contract
      proxyAddress = await proxyDeployer.getLatestProxy(contractName);
    }
    
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
      [contractName, proxyAddress, implementationAddress, deployerAddress, adminAddress, version, true, JSON.stringify({ deploymentTx: tx.hash })]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      contractName,
      proxyAddress,
      implementationAddress,
      version,
      txHash: tx.hash,
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
 * Upgrade an existing proxy to a new implementation
 * @param {string} proxyAddress - Address of the proxy to upgrade
 * @param {string} newImplementationAddress - Address of the new implementation
 * @param {number} newVersion - New version number
 * @param {string} reason - Reason for the upgrade
 * @param {string} upgradeTxHash - Transaction hash of the upgrade (optional, for tracking)
 * @returns {object} - Upgrade result
 */
const upgradeProxy = async (proxyAddress, newImplementationAddress, newVersion, reason, upgradeTxHash = null) => {
  const client = await pool.connect();
  
  try {
    const signer = getSigner();
    const proxyDeployer = getProxyDeployerContract(signer);
    
    // Get current implementation before upgrade
    const oldImplementation = await proxyDeployer.getImplementation(proxyAddress);
    
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
    
    // Perform the upgrade
    const tx = await proxyDeployer.upgradeProxy(
      proxyAddress,
      newImplementationAddress,
      newVersion,
      reason
    );
    
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
 * Get current implementation address from blockchain
 * @param {string} proxyAddress - Address of the proxy
 * @returns {string} - Current implementation address
 */
const getCurrentImplementation = async (proxyAddress) => {
  try {
    const proxy = getProxyContract(proxyAddress);
    return await proxy.implementation();
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
 * Pause a proxy (deactivate)
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
 * Unpause a proxy (reactivate)
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
  getProxyDeployerContract,
  getProxyContract
};

