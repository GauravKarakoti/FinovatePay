const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const { getEscrowContract, getProvider, contractAddresses } = require('../config/blockchain');
const { pool } = require('../config/database');
const Invoice = require('../models/Invoice');

// Cron scheduler for running reconciliation every 6 hours
let cronJob = null;

/**
 * Convert UUID to bytes32 for blockchain calls
 */
const uuidToBytes32 = (uuid) => {
  if (!uuid) return ethers.ZeroHash;
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Map escrow status from contract to standardized status
 */
const mapChainStatusToDb = (chainStatus) => {
  const statusMap = {
    0: 'created',      // Created
    1: 'funded',       // Funded
    2: 'disputed',     // Disputed
    3: 'released',     // Released
    4: 'expired'       // Expired
  };
  return statusMap[chainStatus] || 'unknown';
};

/**
 * Map database status to standardized reconciliation status
 */
const mapDbStatusToReconciliation = (dbStatus) => {
  const statusMap = {
    'pending': 'created',
    'created': 'created',
    'payment_pending': 'created',
    'escrow_locked': 'funded',
    'funded': 'funded',
    'released': 'released',
    'disputed': 'disputed',
    'cancelled': 'expired',
    'failed': 'expired',
    'settled': 'released'
  };
  return statusMap[dbStatus?.toLowerCase()] || 'not_found';
};

/**
 * Get all invoices from database that have escrow data
 */
const getInvoicesWithEscrow = async (limit = 1000, offset = 0) => {
  const query = `
    SELECT 
      invoice_id, 
      amount, 
      escrow_status, 
      status,
      buyer_address,
      seller_address,
      currency,
      tx_hash,
      escrow_tx_hash
    FROM invoices 
    WHERE escrow_status IS NOT NULL 
       OR escrow_tx_hash IS NOT NULL
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;
  const result = await pool.query(query, [limit, offset]);
  return result.rows;
};

/**
 * Get total count of invoices with escrow
 */
const getInvoicesWithEscrowCount = async () => {
  const query = `
    SELECT COUNT(*) as count
    FROM invoices 
    WHERE escrow_status IS NOT NULL 
       OR escrow_tx_hash IS NOT NULL
  `;
  const result = await pool.query(query);
  return parseInt(result.rows[0].count, 10);
};

/**
 * Fetch escrow data from blockchain for a specific invoice
 */
const getEscrowFromChain = async (invoiceId) => {
  try {
    const contract = getEscrowContract();
    if (!contract) {
      return { error: 'Contract not available', status: 'error' };
    }

    const bytes32Id = uuidToBytes32(invoiceId);
    const escrowData = await contract.escrows(bytes32Id);

    // Check if escrow exists (seller address is not 0x0)
    if (escrowData.seller === ethers.ZeroAddress) {
      return { status: 'not_found' };
    }

    return {
      status: 'found',
      chainStatus: mapChainStatusToDb(escrowData.status),
      amount: escrowData.amount.toString(),
      buyer: escrowData.buyer,
      seller: escrowData.seller,
      sellerConfirmed: escrowData.sellerConfirmed,
      buyerConfirmed: escrowData.buyerConfirmed,
      disputeRaised: escrowData.disputeRaised,
      createdAt: escrowData.createdAt.toString(),
      expiresAt: escrowData.expiresAt.toString()
    };
  } catch (error) {
    console.error(`[ReconciliationService] Error fetching escrow for ${invoiceId}:`, error.message);
    return { error: error.message, status: 'error' };
  }
};

/**
 * Compare chain and db data to detect discrepancies
 */
const compareData = (chainData, dbInvoice) => {
  const discrepancy = {
    type: 'none',
    amountDiff: '0',
    issues: []
  };

  // Check status mismatch
  const chainStatus = chainData.status === 'found' ? chainData.chainStatus : 'not_found';
  const dbStatus = mapDbStatusToReconciliation(dbInvoice.escrow_status || dbInvoice.status);

  if (chainStatus !== dbStatus && chainStatus !== 'error') {
    discrepancy.type = discrepancy.type === 'none' ? 'status_mismatch' : discrepancy.type;
    discrepancy.issues.push(`Status mismatch: chain=${chainStatus}, db=${dbStatus}`);
  }

  // Check amount mismatch
  if (chainStatus !== 'not_found' && chainStatus !== 'error' && chainData.amount) {
    const chainAmount = chainData.amount;
    const dbAmount = dbInvoice.amount?.toString() || '0';
    
    if (chainAmount !== dbAmount) {
      // Calculate difference
      try {
        const diff = BigInt(chainAmount) - BigInt(dbAmount);
        discrepancy.amountDiff = diff.toString();
        
        if (discrepancy.type === 'status_mismatch') {
          discrepancy.type = 'status_mismatch'; // Keep existing type
        } else {
          discrepancy.type = 'amount_mismatch';
        }
        discrepancy.issues.push(`Amount mismatch: chain=${chainAmount}, db=${dbAmount}`);
      } catch (e) {
        discrepancy.issues.push(`Amount comparison error: ${e.message}`);
      }
    }
  }

  // Check buyer mismatch
  if (chainData.buyer && dbInvoice.buyer_address) {
    if (chainData.buyer.toLowerCase() !== dbInvoice.buyer_address.toLowerCase()) {
      discrepancy.issues.push(`Buyer mismatch: chain=${chainData.buyer}, db=${dbInvoice.buyer_address}`);
      if (discrepancy.type === 'none') discrepancy.type = 'status_mismatch';
    }
  }

  // Check seller mismatch
  if (chainData.seller && dbInvoice.seller_address) {
    if (chainData.seller.toLowerCase() !== dbInvoice.seller_address.toLowerCase()) {
      discrepancy.issues.push(`Seller mismatch: chain=${chainData.seller}, db=${dbInvoice.seller_address}`);
      if (discrepancy.type === 'none') discrepancy.type = 'status_mismatch';
    }
  }

  // Determine final discrepancy type
  if (chainData.status === 'not_found' && dbInvoice.escrow_status) {
    discrepancy.type = 'missing_chain';
  } else if (chainData.status === 'found' && !dbInvoice.escrow_status) {
    discrepancy.type = 'missing_db';
  }

  return discrepancy;
};

/**
 * Log reconciliation result to database
 */
const logReconciliationResult = async (logData) => {
  const query = `
    INSERT INTO reconciliation_logs (
      invoice_id,
      chain_status,
      db_status,
      chain_amount,
      db_amount,
      discrepancy_amount,
      discrepancy_type,
      chain_buyer,
      db_buyer,
      chain_seller,
      db_seller,
      reconciliation_type,
      run_id,
      notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  `;

  const values = [
    logData.invoiceId,
    logData.chainStatus,
    logData.dbStatus,
    logData.chainAmount || null,
    logData.dbAmount || null,
    logData.discrepancyAmount || '0',
    logData.discrepancyType,
    logData.chainBuyer || null,
    logData.dbBuyer || null,
    logData.chainSeller || null,
    logData.dbSeller || null,
    logData.reconciliationType,
    logData.runId,
    logData.notes || null
  ];

  await pool.query(query, values);
};

/**
 * Create or update reconciliation summary
 */
const createReconciliationSummary = async (runId, runType, totalInvoices) => {
  const query = `
    INSERT INTO reconciliation_summary (
      run_id,
      run_type,
      total_invoices,
      started_at,
      status
    ) VALUES ($1, $2, $3, NOW(), 'running')
    ON CONFLICT (run_id) DO UPDATE SET
      run_type = $2,
      total_invoices = $3,
      started_at = NOW(),
      status = 'running'
    RETURNING *
  `;
  
  const result = await pool.query(query, [runId, runType, totalInvoices]);
  return result.rows[0];
};

/**
 * Update reconciliation summary with results
 */
const updateReconciliationSummary = async (runId, summary) => {
  const query = `
    UPDATE reconciliation_summary
    SET 
      matched_count = $2,
      discrepancy_count = $3,
      missing_chain_count = $4,
      missing_db_count = $5,
      total_discrepancy_amount = $6,
      completed_at = NOW(),
      status = $7,
      error_message = $8
    WHERE run_id = $1
    RETURNING *
  `;

  const values = [
    runId,
    summary.matchedCount,
    summary.discrepancyCount,
    summary.missingChainCount,
    summary.missingDbCount,
    summary.totalDiscrepancyAmount,
    summary.status,
    summary.errorMessage || null
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
};

/**
 * Main reconciliation function
 */
const runReconciliation = async (reconciliationType = 'manual', batchSize = 50) => {
  const runId = uuidv4();
  const startTime = Date.now();
  
  console.log(`[ReconciliationService] Starting ${reconciliationType} reconciliation run: ${runId}`);

  const summary = {
    matchedCount: 0,
    discrepancyCount: 0,
    missingChainCount: 0,
    missingDbCount: 0,
    totalDiscrepancyAmount: '0',
    status: 'completed',
    errorMessage: null
  };

  try {
    // Get total count
    const totalInvoices = await getInvoicesWithEscrowCount();
    await createReconciliationSummary(runId, reconciliationType, totalInvoices);

    console.log(`[ReconciliationService] Total invoices to reconcile: ${totalInvoices}`);

    // Process in batches
    let processed = 0;
    let offset = 0;

    while (offset < totalInvoices) {
      const invoices = await getInvoicesWithEscrow(batchSize, offset);
      
      if (!invoices || invoices.length === 0) break;

      // Process each invoice
      for (const invoice of invoices) {
        try {
          // Fetch chain data
          const chainData = await getEscrowFromChain(invoice.invoice_id);
          
          // Compare with database
          const discrepancy = compareData(chainData, invoice);

          // Determine statuses
          let chainStatus = chainData.status === 'found' ? chainData.chainStatus : 
                           chainData.status === 'error' ? 'error' : 'not_found';
          const dbStatus = mapDbStatusToReconciliation(invoice.escrow_status || invoice.status);

          // Log the result
          await logReconciliationResult({
            invoiceId: invoice.invoice_id,
            chainStatus: chainStatus,
            dbStatus: dbStatus,
            chainAmount: chainData.amount,
            dbAmount: invoice.amount?.toString(),
            discrepancyAmount: discrepancy.amountDiff,
            discrepancyType: discrepancy.type,
            chainBuyer: chainData.buyer,
            dbBuyer: invoice.buyer_address,
            chainSeller: chainData.seller,
            dbSeller: invoice.seller_address,
            reconciliationType: reconciliationType,
            runId: runId,
            notes: discrepancy.issues.length > 0 ? discrepancy.issues.join('; ') : null
          });

          // Update summary counts
          if (discrepancy.type === 'none') {
            summary.matchedCount++;
          } else {
            summary.discrepancyCount++;
            
            if (discrepancy.type === 'missing_chain') {
              summary.missingChainCount++;
            } else if (discrepancy.type === 'missing_db') {
              summary.missingDbCount++;
            }

            // Add to total discrepancy amount (use absolute value)
            try {
              const absDiff = discrepancy.amountDiff.startsWith('-') 
                ? discrepancy.amountDiff.slice(1) 
                : discrepancy.amountDiff;
              if (absDiff !== '0') {
                summary.totalDiscrepancyAmount = (
                  BigInt(summary.totalDiscrepancyAmount) + BigInt(absDiff)
                ).toString();
              }
            } catch (e) {
              // Ignore amount calculation errors
            }
          }

          processed++;
        } catch (error) {
          console.error(`[ReconciliationService] Error processing invoice ${invoice.invoice_id}:`, error.message);
          
          // Log error
          await logReconciliationResult({
            invoiceId: invoice.invoice_id,
            chainStatus: 'error',
            dbStatus: mapDbStatusToReconciliation(invoice.escrow_status || invoice.status),
            discrepancyType: 'error',
            reconciliationType: reconciliationType,
            runId: runId,
            notes: error.message
          });
        }
      }

      offset += batchSize;
      console.log(`[ReconciliationService] Processed ${offset}/${totalInvoices} invoices`);
    }

    // Update summary
    await updateReconciliationSummary(runId, summary);

    const duration = Date.now() - startTime;
    console.log(`[ReconciliationService] Reconciliation run ${runId} completed in ${duration}ms`);
    console.log(`[ReconciliationService] Results: matched=${summary.matchedCount}, discrepancies=${summary.discrepancyCount}, missing_chain=${summary.missingChainCount}, missing_db=${summary.missingDbCount}`);

    return {
      runId,
      status: 'completed',
      summary: {
        ...summary,
        totalInvoices,
        processed
      }
    };

  } catch (error) {
    console.error(`[ReconciliationService] Reconciliation failed:`, error);
    summary.status = 'failed';
    summary.errorMessage = error.message;
    
    await updateReconciliationSummary(runId, summary);

    return {
      runId,
      status: 'failed',
      error: error.message
    };
  }
};

/**
 * Get reconciliation status (latest run)
 */
const getReconciliationStatus = async () => {
  const query = `
    SELECT 
      run_id,
      run_type,
      total_invoices,
      matched_count,
      discrepancy_count,
      missing_chain_count,
      missing_db_count,
      total_discrepancy_amount,
      started_at,
      completed_at,
      status,
      error_message
    FROM reconciliation_summary
    ORDER BY created_at DESC
    LIMIT 1
  `;

  const result = await pool.query(query);
  
  if (result.rows.length === 0) {
    return {
      hasRun: false,
      message: 'No reconciliation runs yet'
    };
  }

  const latestRun = result.rows[0];
  
  // Calculate duration if completed
  let duration = null;
  if (latestRun.started_at && latestRun.completed_at) {
    duration = new Date(latestRun.completed_at) - new Date(latestRun.started_at);
  }

  return {
    hasRun: true,
    runId: latestRun.run_id,
    runType: latestRun.run_type,
    totalInvoices: parseInt(latestRun.total_invoices, 10),
    matchedCount: parseInt(latestRun.matched_count, 10),
    discrepancyCount: parseInt(latestRun.discrepancy_count, 10),
    missingChainCount: parseInt(latestRun.missing_chain_count, 10),
    missingDbCount: parseInt(latestRun.missing_db_count, 10),
    totalDiscrepancyAmount: latestRun.total_discrepancy_amount,
    startedAt: latestRun.started_at,
    completedAt: latestRun.completed_at,
    duration: duration,
    status: latestRun.status,
    errorMessage: latestRun.error_message
  };
};

/**
 * Get discrepancies with optional filters
 */
const getDiscrepancies = async (limit = 100, offset = 0, type = null) => {
  let query = `
    SELECT 
      invoice_id,
      chain_status,
      db_status,
      chain_amount,
      db_amount,
      discrepancy_amount,
      discrepancy_type,
      chain_buyer,
      db_buyer,
      chain_seller,
      db_seller,
      notes,
      created_at
    FROM reconciliation_logs
    WHERE discrepancy_type != 'none'
  `;

  const values = [limit, offset];

  if (type) {
    query += ` AND discrepancy_type = $3`;
    values.push(type);
  }

  query += ` ORDER BY created_at DESC LIMIT $1 OFFSET $2`;

  const result = await pool.query(query, values);

  // Get total count
  let countQuery = `
    SELECT COUNT(*) as count
    FROM reconciliation_logs
    WHERE discrepancy_type != 'none'
  `;
  
  if (type) {
    countQuery += ` AND discrepancy_type = $1`;
  }

  const countResult = type 
    ? await pool.query(countQuery, [type])
    : await pool.query(countQuery);

  return {
    discrepancies: result.rows,
    total: parseInt(countResult.rows[0].count, 10),
    limit,
    offset
  };
};

/**
 * Get reconciliation history
 */
const getReconciliationHistory = async (limit = 10, offset = 0) => {
  const query = `
    SELECT 
      run_id,
      run_type,
      total_invoices,
      matched_count,
      discrepancy_count,
      missing_chain_count,
      missing_db_count,
      total_discrepancy_amount,
      started_at,
      completed_at,
      status,
      error_message
    FROM reconciliation_summary
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;

  const result = await pool.query(query, [limit, offset]);

  // Get total count
  const countQuery = `SELECT COUNT(*) as count FROM reconciliation_summary`;
  const countResult = await pool.query(countQuery);

  return {
    runs: result.rows,
    total: parseInt(countResult.rows[0].count, 10),
    limit,
    offset
  };
};

/**
 * Start scheduled reconciliation (every 6 hours)
 */
const startScheduledReconciliation = () => {
  // Dynamic import for node-cron (optional dependency)
  let cron;
  try {
    cron = require('node-cron');
  } catch (e) {
    console.warn('[ReconciliationService] node-cron not installed. Run: npm install node-cron');
    console.warn('[ReconciliationService] Using setInterval as fallback (every 6 hours)');
    
    // Fallback to setInterval (6 hours = 6 * 60 * 60 * 1000 ms)
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    
    setInterval(async () => {
      console.log('[ReconciliationService] Running scheduled reconciliation...');
      try {
        await runReconciliation('scheduled');
      } catch (error) {
        console.error('[ReconciliationService] Scheduled reconciliation failed:', error);
      }
    }, SIX_HOURS);
    
    return;
  }

  // Schedule: Run every 6 hours at minute 0
  // '0 */6 * * *' = At minute 0 past every 6th hour
  cron.schedule('0 */6 * * *', async () => {
    console.log('[ReconciliationService] Running scheduled reconciliation...');
    try {
      await runReconciliation('scheduled');
    } catch (error) {
      console.error('[ReconciliationService] Scheduled reconciliation failed:', error);
    }
  });

  console.log('[ReconciliationService] Scheduled reconciliation enabled: runs every 6 hours');
};

/**
 * Stop scheduled reconciliation
 */
const stopScheduledReconciliation = () => {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[ReconciliationService] Scheduled reconciliation stopped');
  }
};

module.exports = {
  runReconciliation,
  getReconciliationStatus,
  getDiscrepancies,
  getReconciliationHistory,
  startScheduledReconciliation,
  stopScheduledReconciliation,
  getEscrowFromChain,
  compareData
};
