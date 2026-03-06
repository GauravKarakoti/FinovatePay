/**
 * Multi-Sig Wallet Service
 * Handles interaction with the MultiSigWallet and EscrowContract for high-value transactions
 */

const { ethers } = require('ethers');
const { contractAddresses, getSigner, getProvider } = require('../config/blockchain');
const { pool } = require('../config/database');

// Helper: UUID → bytes32
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Check if a transaction requires multi-sig approval
 * @param {string} invoiceId - The invoice ID
 * @returns {Promise<boolean>} - Whether multi-sig is required
 */
const checkMultiSigRequired = async (invoiceId) => {
  try {
    const escrowContract = require('../config/blockchain').getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    const requiresMultiSig = await escrowContract.checkMultiSigRequired(bytes32InvoiceId);
    return requiresMultiSig;
  } catch (error) {
    console.error('Error checking multi-sig requirement:', error);
    throw error;
  }
};

/**
 * Get multi-sig approval status for an escrow
 * @param {string} invoiceId - The invoice ID
 * @returns {Promise<Object>} - Approval status
 */
const getMultiSigStatus = async (invoiceId) => {
  try {
    const escrowContract = require('../config/blockchain').getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    const [approvers, required, approvalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);
    
    return {
      approvers: approvers.map(a => a.toLowerCase()),
      required: Number(required),
      approvalCount: Number(approvalCount),
      isFullyApproved: Number(approvalCount) >= Number(required)
    };
  } catch (error) {
    console.error('Error getting multi-sig status:', error);
    throw error;
  }
};

/**
 * Add multi-sig approval for a high-value transaction
 * @param {string} invoiceId - The invoice ID
 * @param {string} approverAddress - The address of the approver
 * @returns {Promise<Object>} - Transaction result
 */
const addMultiSigApproval = async (invoiceId, approverAddress) => {
  const client = await pool.connect();
  
  try {
    const signer = getSigner();
    const escrowContract = require('../config/blockchain').getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    // Connect contract with signer
    const contractWithSigner = escrowContract.connect(signer);
    
    // Add approval
    const tx = await contractWithSigner.addMultiSigApproval(bytes32InvoiceId);
    const receipt = await tx.wait();
    
    // Get updated approval status
    const [approvers, required, approvalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);
    
    await client.query('BEGIN');
    
    // Store approval record in database
    await client.query(
      `INSERT INTO high_value_tx_approval_records (approval_id, approver_address, tx_hash)
       VALUES ($1, $2, $3)`,
      [invoiceId, approverAddress, tx.hash]
    );
    
    // Update approval count in database
    const escrowResult = await client.query(
      `SELECT id FROM high_value_tx_approvals WHERE invoice_id = $1`,
      [invoiceId]
    );
    
    if (escrowResult.rows.length > 0) {
      await client.query(
        `UPDATE high_value_tx_approvals 
         SET current_approvals = $1, updated_at = CURRENT_TIMESTAMP
         WHERE invoice_id = $2`,
        [Number(approvalCount), invoiceId]
      );
    }
    
    await client.query('COMMIT');
    
    return {
      success: true,
      txHash: tx.hash,
      approvalCount: Number(approvalCount),
      required: Number(required),
      isFullyApproved: Number(approvalCount) >= Number(required)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error adding multi-sig approval:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Create a high-value transaction record
 * @param {Object} data - Transaction data
 * @returns {Promise<Object>} - Created record
 */
const createHighValueTx = async (data) => {
  const client = await pool.connect();
  
  try {
    const { invoiceId, escrowId, amount, tokenAddress, requiredApprovals, createdBy } = data;
    
    await client.query('BEGIN');
    
    const result = await client.query(
      `INSERT INTO high_value_tx_approvals 
       (invoice_id, escrow_id, amount, token_address, required_approvals, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [invoiceId, escrowId, amount, tokenAddress, requiredApprovals, createdBy]
    );
    
    await client.query('COMMIT');
    
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating high-value transaction:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get high-value transaction details
 * @param {string} invoiceId - The invoice ID
 * @returns {Promise<Object>} - Transaction details
 */
const getHighValueTx = async (invoiceId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM high_value_tx_approvals WHERE invoice_id = $1`,
      [invoiceId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  } catch (error) {
    console.error('Error getting high-value transaction:', error);
    throw error;
  }
};

/**
 * Get all high-value transactions
 * @param {string} status - Optional status filter
 * @returns {Promise<Array>} - List of transactions
 */
const getAllHighValueTxs = async (status = null) => {
  try {
    let query = 'SELECT * FROM high_value_tx_approvals';
    const params = [];
    
    if (status) {
      query += ' WHERE status = $1';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    console.error('Error getting high-value transactions:', error);
    throw error;
  }
};

/**
 * Update multi-sig configuration
 * @param {string} key - Configuration key
 * @param {string} value - Configuration value
 * @param {string} updatedBy - Who is updating
 * @returns {Promise<Object>} - Updated configuration
 */
const updateConfig = async (key, value, updatedBy) => {
  try {
    const result = await pool.query(
      `UPDATE multi_sig_config 
       SET value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
       WHERE key = $3
       RETURNING *`,
      [value, updatedBy, key]
    );
    
    return result.rows[0];
  } catch (error) {
    console.error('Error updating multi-sig config:', error);
    throw error;
  }
};

/**
 * Get multi-sig configuration
 * @param {string} key - Configuration key
 * @returns {Promise<string>} - Configuration value
 */
const getConfig = async (key) => {
  try {
    const result = await pool.query(
      `SELECT value FROM multi_sig_config WHERE key = $1`,
      [key]
    );
    
    return result.rows.length > 0 ? result.rows[0].value : null;
  } catch (error) {
    console.error('Error getting multi-sig config:', error);
    throw error;
  }
};

/**
 * Create a new multi-sig wallet
 * @param {Object} data - Wallet data
 * @returns {Promise<Object>} - Created wallet
 */
const createMultiSigWallet = async (data) => {
  const client = await pool.connect();
  
  try {
    const { name, owners, threshold, maxValue, requiredConfirmations, createdBy } = data;
    
    await client.query('BEGIN');
    
    // Insert wallet configuration
    const walletResult = await client.query(
      `INSERT INTO multi_sig_wallets 
       (name, threshold, max_value, required_confirmations, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, threshold || 2, maxValue || '10000000000000000000000', requiredConfirmations || 2, createdBy]
    );
    
    const walletId = walletResult.rows[0].id;
    
    // Insert owners
    for (let i = 0; i < owners.length; i++) {
      await client.query(
        `INSERT INTO multi_sig_owners 
         (wallet_id, owner_address, owner_name, is_primary, added_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [walletId, owners[i].address, owners[i].name, i === 0, createdBy]
      );
    }
    
    await client.query('COMMIT');
    
    return walletResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating multi-sig wallet:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  checkMultiSigRequired,
  getMultiSigStatus,
  addMultiSigApproval,
  createHighValueTx,
  getHighValueTx,
  getAllHighValueTxs,
  updateConfig,
  getConfig,
  createMultiSigWallet
};

