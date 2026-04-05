/**
 * Yield Pool Service
 * Manages yield pool deposits, earnings, and distributions for idle escrow funds
 */

const { pool } = require('../config/database');
const { ethers } = require('ethers');
const { contractAddresses } = require('../config/blockchain');
const EscrowYieldPoolArtifact = require('../../deployed/EscrowYieldPool.json');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { getSigner } = require('../config/blockchain');

/**
 * Get EscrowYieldPool contract instance
 */
const getYieldPoolContract = (signer) => {
  return new ethers.Contract(
    contractAddresses.escrowYieldPool,
    EscrowYieldPoolArtifact.abi,
    signer || getSigner()
  );
};

/**
 * Get EscrowContract instance
 */
const getEscrowContract = (signer) => {
  return new ethers.Contract(
    contractAddresses.escrowContract,
    EscrowContractArtifact,
    signer || getSigner()
  );
};

/**
 * Convert UUID to bytes32
 */
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Deposit funds from an escrow into the yield pool
 * @param {string} invoiceId - The invoice ID
 * @param {string} txHash - The transaction hash
 * @returns {Promise<object>} - Deposit details
 */
const depositToYieldPool = async (invoiceId, txHash) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get escrow details
    const escrowResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );
    
    if (escrowResult.rows.length === 0) {
      throw new Error('Invoice not found');
    }
    
    const invoice = escrowResult.rows[0];
    
    // Record the deposit
    await client.query(
      `INSERT INTO escrow_yield_deposits (invoice_id, deposit_tx_hash, principal_amount, asset_address)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [invoiceId, txHash, invoice.amount.toString(), invoice.token_address || contractAddresses.usdc]
    );
    
    // Initialize yield earnings record
    await client.query(
      `INSERT INTO escrow_yield_earnings (invoice_id, total_yield_earned, seller_yield_claimed, platform_fee_claimed)
       VALUES ($1, 0, 0, 0)
       ON CONFLICT (invoice_id) DO NOTHING`,
      [invoiceId]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      invoiceId,
      txHash,
      message: 'Funds deposited to yield pool successfully'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error depositing to yield pool:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Record yield earnings for an escrow
 * @param {string} invoiceId - The invoice ID
 * @param {string} yieldAmount - The yield amount (in wei)
 * @returns {Promise<object>} - Updated earnings
 */
const recordYieldEarnings = async (invoiceId, yieldAmount) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Update yield earnings
    const result = await client.query(
      `UPDATE escrow_yield_earnings 
       SET total_yield_earned = total_yield_earned + $1,
           last_updated_at = NOW()
       WHERE invoice_id = $2
       RETURNING *`,
      [yieldAmount, invoiceId]
    );
    
    if (result.rows.length === 0) {
      // Insert new record if not exists
      await client.query(
        `INSERT INTO escrow_yield_earnings (invoice_id, total_yield_earned, seller_yield_claimed, platform_fee_claimed)
         VALUES ($1, $2, 0, 0)`,
        [invoiceId, yieldAmount]
      );
    }
    
    // Update global stats
    await client.query(
      `UPDATE yield_pool_stats 
       SET total_yield_earned = total_yield_earned + $1,
           updated_at = NOW()`,
      [yieldAmount]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      invoiceId,
      yieldAmount,
      message: 'Yield earnings recorded successfully'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording yield earnings:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Claim yield for an escrow (distribute to seller and platform)
 * @param {string} invoiceId - The invoice ID
 * @param {string} sellerYield - Seller's share of yield
 * @param {string} platformFee - Platform fee
 * @returns {Promise<object>} - Claim details
 */
const claimYield = async (invoiceId, sellerYield, platformFee) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Update yield earnings with claimed amounts
    await client.query(
      `UPDATE escrow_yield_earnings 
       SET seller_yield_claimed = seller_yield_claimed + $1,
           platform_fee_claimed = platform_fee_claimed + $2,
           last_updated_at = NOW()
       WHERE invoice_id = $3`,
      [sellerYield, platformFee, invoiceId]
    );
    
    // Update global stats
    await client.query(
      `UPDATE yield_pool_stats 
       SET total_distributed = total_distributed + $1,
           total_platform_fees = total_platform_fees + $2,
           updated_at = NOW()`,
      [sellerYield, platformFee]
    );
    
    await client.query('COMMIT');
    
    return {
      success: true,
      invoiceId,
      sellerYield,
      platformFee,
      message: 'Yield claimed and distributed successfully'
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error claiming yield:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get yield information for an invoice
 * @param {string} invoiceId - The invoice ID
 * @returns {Promise<object>} - Yield information
 */
const getYieldInfo = async (invoiceId) => {
  try {
    const depositResult = await pool.query(
      'SELECT * FROM escrow_yield_deposits WHERE invoice_id = $1',
      [invoiceId]
    );
    
    const earningsResult = await pool.query(
      'SELECT * FROM escrow_yield_earnings WHERE invoice_id = $1',
      [invoiceId]
    );
    
    const escrowContract = getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    // Get on-chain yield info
    let onChainInfo = { inYieldPool: false, estimatedYield: 0 };
    try {
      onChainInfo = await escrowContract.getYieldInfo(bytes32InvoiceId);
    } catch (e) {
      // Contract might not have yield pool configured
      console.log('Yield pool not configured for escrow');
    }
    
    return {
      invoiceId,
      deposit: depositResult.rows[0] || null,
      earnings: earningsResult.rows[0] || null,
      onChain: {
        inYieldPool: onChainInfo.inYieldPool,
        estimatedYield: onChainInfo.estimatedYield?.toString() || '0'
      }
    };
  } catch (error) {
    console.error('Error getting yield info:', error);
    throw error;
  }
};

/**
 * Get global yield pool statistics
 * @returns {Promise<object>} - Pool statistics
 */
const getPoolStats = async () => {
  try {
    const result = await pool.query('SELECT * FROM yield_pool_stats LIMIT 1');
    
    if (result.rows.length === 0) {
      return {
        totalDeposits: '0',
        totalYieldEarned: '0',
        totalDistributed: '0',
        totalPlatformFees: '0'
      };
    }
    
    const stats = result.rows[0];
    return {
      totalDeposits: stats.total_deposits.toString(),
      totalYieldEarned: stats.total_yield_earned.toString(),
      totalDistributed: stats.total_distributed.toString(),
      totalPlatformFees: stats.total_platform_fees.toString(),
      updatedAt: stats.updated_at
    };
  } catch (error) {
    console.error('Error getting pool stats:', error);
    throw error;
  }
};

/**
 * Get all escrows in yield pool
 * @returns {Promise<array>} - List of escrows in yield pool
 */
const getEscrowsInYieldPool = async () => {
  try {
    const result = await pool.query(
      `SELECT eyd.*, eye.total_yield_earned, eye.seller_yield_claimed, eye.platform_fee_claimed
       FROM escrow_yield_deposits eyd
       LEFT JOIN escrow_yield_earnings eye ON eyd.invoice_id = eye.invoice_id
       ORDER BY eyd.deposited_at DESC`
    );
    
    return result.rows;
  } catch (error) {
    console.error('Error getting escrows in yield pool:', error);
    throw error;
  }
};

module.exports = {
  depositToYieldPool,
  recordYieldEarnings,
  claimYield,
  getYieldInfo,
  getPoolStats,
  getEscrowsInYieldPool,
  getYieldPoolContract,
  getEscrowContract
};
