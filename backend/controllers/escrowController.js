const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { logAudit, logFinancialTransaction } = require('../middleware/auditLogger');
const {
  createTransactionState,
  updateTransactionState,
  addToRecoveryQueue,
} = require('../services/recoveryService');
const errorResponse = require('../utils/errorResponse');
const { blockchainQueue, JOB_TYPES } = require('../queues/blockchainQueue');

/* -------------------------------------------------------------------------- */
/* HELPERS */
/* -------------------------------------------------------------------------- */

const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Release escrow funds asynchronously via queue
 * This immediately returns a job ID and processes the transaction in background
 */
exports.releaseEscrow = async (req, res) => {
  const client = await pool.connect();
  let correlationId = null;
  let stepsCompleted = []; // Track actual progress for recovery
  let txHash = null; // Track tx hash if blockchain tx succeeds

exports.releaseEscrow = async (req, res) => {
  try {
    const { invoiceId } = req.body;
    const userId = req.user?.id;

    // Validate invoice exists and user has access
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];
    
    // Validate invoice state
    if (!invoice.escrow_status) {
      logger.error('Invoice missing escrow_status field', { invoiceId });
      throw new Error('Invalid invoice state: missing escrow_status');
    }

    // Check if escrow is in a state that allows release
    if (!['deposited', 'confirmed'].includes(invoice.escrow_status)) {
      return res.status(400).json({ 
        error: `Cannot release escrow in ${invoice.escrow_status} state` 
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_RELEASE, {
      invoiceId,
      userId,
    });

    // Immediately return job ID for status tracking
    res.json({ 
      success: true, 
      jobId: job.jobId,
      message: 'Escrow release queued for processing',
      invoiceId,
    });

  } catch (error) {
    console.error("Error in releaseEscrow:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Release escrow funds synchronously (legacy method - waits for confirmation)
 * Use this for backwards compatibility or when immediate confirmation is needed
 */
exports.releaseEscrowSync = async (req, res) => {
  try {
    const { invoiceId } = req.body;

    const io = req.app.get("io");

    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      getSigner()
    );

    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    const financialTx = await logFinancialTransaction({
      transactionType: 'ESCROW_RELEASE',
      invoiceId,
      fromAddress: invoice.buyer_address,
      toAddress: invoice.seller_address,
      amount: invoice.amount,
      status: 'PENDING',
      initiatedBy: req.user.id,
      metadata: { correlationId },
    });

    const tx = await escrowContract.confirmRelease(bytes32InvoiceId);
    await tx.wait();

    txHash = tx.hash;
    stepsCompleted.push('BLOCKCHAIN_TX');

    await updateTransactionState(correlationId, 'PROCESSING', {
      stepsCompleted,
    });

    await client.query(
      `UPDATE invoices
       SET escrow_status=$1, release_tx_hash=$2
       WHERE invoice_id=$3`,
      ['released', tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    stepsCompleted.push('DB_UPDATE');

    if (financialTx) {
      await pool.query(
        `UPDATE financial_transactions
         SET status=$1, blockchain_tx_hash=$2, confirmed_at=NOW()
         WHERE transaction_id=$3`,
        ['CONFIRMED', tx.hash, financialTx.transaction_id]
      );
    }

    await logAudit({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      action: 'RELEASE',
      status: 'SUCCESS',
      metadata: { txHash, correlationId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await updateTransactionState(correlationId, 'COMPLETED', {
      stepsCompleted: ['BLOCKCHAIN_TX', 'DB_UPDATE', 'AUDIT_LOG'],
    });

    if (io) {
      io.to(`invoice-${invoiceId}`).emit('escrow:released', {
        invoiceId,
        txHash,
      });
    }

    return res.json({
      success: true,
      txHash,
      correlationId,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    return res.json({ success: true, txHash: tx.hash, correlationId });

  } catch (error) {
    console.error("Error in releaseEscrowSync:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Raise dispute asynchronously via queue
 */
exports.raiseDispute = async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId, reason } = req.body;
    const userId = req.user?.id;

    if (!reason?.trim()) {
      return res.status(400).json({ error: 'Dispute reason is required' });
    }

    // Validate invoice exists
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Check if escrow can be disputed
    if (!['deposited', 'confirmed'].includes(invoice.escrow_status)) {
      return res.status(400).json({ 
        error: `Cannot dispute escrow in ${invoice.escrow_status} state` 
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DISPUTE, {
      invoiceId,
      reason,
      userId,
    });

    res.json({ 
      success: true, 
      jobId: job.jobId,
      message: 'Dispute queued for processing',
      invoiceId,
    });

  } catch (error) {
    console.error("Error in raiseDispute:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Raise dispute synchronously (legacy method)
 */
exports.raiseDisputeSync = async (req, res) => {
  try {
    const { invoiceId, reason } = req.body;

    const io = req.app.get("io");

    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      getSigner()
    );

    return res.json({
      success: true,
      jobId: job.jobId,
      message: 'Deposit queued',
      invoiceId,
    });
  } catch (error) {
    logger.error('depositEscrow failed', { error: error.message });
    return errorResponse(res, error.message, 500);
  }
};

/* -------------------------------------------------------------------------- */
/* JOB STATUS */
/* -------------------------------------------------------------------------- */

exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const jobStatus = await blockchainQueue.getJobStatus(jobId);

    if (!jobStatus) {
      return errorResponse(res, 'Job not found', 404);
    }

    return res.json(jobStatus);
  } catch (error) {
    console.error("Error in raiseDisputeSync:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Deposit to escrow asynchronously via queue
 */
exports.depositEscrow = async (req, res) => {
  try {
    const { invoiceId, amount, tokenAddress } = req.body;
    const userId = req.user?.id;

    // Validate invoice exists
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Check if escrow can accept deposit
    if (invoice.escrow_status !== 'pending') {
      return res.status(400).json({ 
        error: `Cannot deposit to escrow in ${invoice.escrow_status} state` 
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DEPOSIT, {
      invoiceId,
      amount,
      tokenAddress: tokenAddress || ethers.ZeroAddress,
      userId,
    });

    res.json({ 
      success: true, 
      jobId: job.jobId,
      message: 'Deposit queued for processing',
      invoiceId,
    });

  } catch (error) {
    console.error("Error in raiseDisputeSync:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Deposit to escrow asynchronously via queue
 */
exports.depositEscrow = async (req, res) => {
  try {
    const { invoiceId, amount, tokenAddress } = req.body;
    const userId = req.user?.id;

    // Validate invoice exists
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const invoice = invoiceResult.rows[0];

    // Check if escrow can accept deposit
    if (invoice.escrow_status !== 'pending') {
      return res.status(400).json({ 
        error: `Cannot deposit to escrow in ${invoice.escrow_status} state` 
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DEPOSIT, {
      invoiceId,
      amount,
      tokenAddress: tokenAddress || ethers.ZeroAddress,
      userId,
    });

    res.json({ 
      success: true, 
      jobId: job.jobId,
      message: 'Deposit queued for processing',
      invoiceId,
    });

  } catch (error) {
    console.error("Error in depositEscrow:", error);
    return errorResponse(res, error, 500);
  }
};

/**
 * Get job status for an invoice's blockchain operations
 */
exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const jobStatus = await blockchainQueue.getJobStatus(jobId);

    if (!jobStatus) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(jobStatus);
  } catch (error) {
    console.error("Error in getJobStatus:", error);
    return errorResponse(res, error, 500);
  }
};