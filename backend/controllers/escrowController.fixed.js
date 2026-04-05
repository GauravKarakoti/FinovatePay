const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json').interface.fragments;
const logger = require('../utils/logger')('escrowController');
const TransactionWrapper = require('../utils/transactionWrapper');
const IdempotencyKeyManager = require('../utils/idempotencyKey');
const StateSnapshotManager = require('../utils/stateSnapshot');
const TransactionAuditTrail = require('../utils/transactionAuditTrail');
const errorResponse = require('../utils/errorResponse');
const { blockchainQueue, JOB_TYPES } = require('../queues/blockchainQueue');
const {
  createTransactionState,
  updateTransactionState,
  addToRecoveryQueue,
} = require('../services/recoveryService');

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
  try {
    const { invoiceId } = req.body;
    const userId = req.user?.id;

    // Validate invoice exists first (outside transaction)
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
        error: `Cannot release escrow in ${invoice.escrow_status} state`,
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_RELEASE, {
      invoiceId,
      userId,
    });

    // Log audit trail
    await TransactionAuditTrail.logTransaction({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      action: 'QUEUE_JOB',
      actorId: userId,
      status: 'INITIATED',
      metadata: { jobId: job.jobId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Immediately return job ID for status tracking
    res.json({
      success: true,
      jobId: job.jobId,
      message: 'Escrow release queued for processing',
      invoiceId,
    });
  } catch (error) {
    logger.error('Error in releaseEscrow:', { error: error.message, stack: error.stack });
    return errorResponse(res, error, 500);
  }
};

/**
 * Release escrow funds synchronously with full transaction boundaries
 * Uses transaction wrapper to ensure ACID properties
 */
exports.releaseEscrowSync = async (req, res) => {
  let correlationId = null;
  let beforeSnapshotId = null;

  try {
    const { invoiceId } = req.body;
    const userId = req.user?.id;
    const io = req.app.get('io');

    // Generate idempotency key for safety
    const idempotencyKey = IdempotencyKeyManager.generateKey('escrow-release-sync', {
      invoiceId,
      userId,
    });

    // Check if this operation was already processed
    const cachedResult = await IdempotencyKeyManager.checkKey(idempotencyKey);
    if (cachedResult) {
      logger.info(`Returning cached result for idempotency key: ${idempotencyKey}`);
      return res.json(cachedResult);
    }

    // Create transaction state
    correlationId = await createTransactionState({
      operationType: 'ESCROW_RELEASE_SYNC',
      entityType: 'INVOICE',
      entityId: invoiceId,
      stepsRemaining: [
        'VALIDATE_INVOICE',
        'CREATE_SNAPSHOT_BEFORE',
        'BLOCKCHAIN_TX',
        'DB_UPDATE',
        'AUDIT_LOG',
        'CREATE_SNAPSHOT_AFTER',
      ],
      initiatedBy: userId,
    });

    const transactionResult = await TransactionWrapper.withTransaction(
      async (tx) => {
        // Step 1: Validate and fetch invoice within transaction
        const invoiceRes = await tx.query(
          'VALIDATE_INVOICE',
          'SELECT * FROM invoices WHERE invoice_id = $1',
          [invoiceId]
        );

        if (invoiceRes.rows.length === 0) {
          throw new Error('Invoice not found');
        }

        const invoice = invoiceRes.rows[0];

        if (!['deposited', 'confirmed'].includes(invoice.escrow_status)) {
          throw new Error(`Cannot release escrow in ${invoice.escrow_status} state`);
        }

        // Step 2: Create before snapshot
        beforeSnapshotId = await StateSnapshotManager.createBeforeSnapshot(
          'ESCROW_RELEASE',
          'INVOICE',
          invoiceId,
          {
            escrow_status: invoice.escrow_status,
            amount: invoice.amount,
            buyer_address: invoice.buyer_address,
            seller_address: invoice.seller_address,
          }
        );

        tx.addSnapshot('beforeSnapshot', { id: beforeSnapshotId });

        // Step 3: Execute blockchain transaction
        const escrowContract = new ethers.Contract(
          contractAddresses.escrowContract,
          EscrowContractArtifact,
          getSigner()
        );

        const bytes32InvoiceId = uuidToBytes32(invoiceId);
        const blockchainTx = await escrowContract.confirmRelease(bytes32InvoiceId);
        const blockchainReceipt = await blockchainTx.wait();

        if (!blockchainReceipt || blockchainReceipt.status !== 1) {
          throw new Error('Blockchain transaction failed or was reverted');
        }

        tx.addSnapshot('blockchainTx', {
          hash: blockchainTx.hash,
          receipt: blockchainReceipt,
        });

        // Step 4: Update database within transaction
        await tx.query(
          'UPDATE_INVOICE_STATUS',
          `UPDATE invoices
           SET escrow_status = $1, release_tx_hash = $2, updated_at = NOW()
           WHERE invoice_id = $3`,
          ['released', blockchainTx.hash, invoiceId]
        );

        // Log financial transaction if applicable
        await tx.query(
          'LOG_FINANCIAL_TX',
          `INSERT INTO financial_transactions 
           (invoice_id, transaction_type, status, blockchain_tx_hash, initiated_by)
           VALUES ($1, $2, $3, $4, $5)`,
          ['ESCROW_RELEASE', invoiceId, 'CONFIRMED', blockchainTx.hash, userId]
        );

        return {
          txHash: blockchainTx.hash,
          receipt: blockchainReceipt,
          beforeSnapshotId,
        };
      },
      'ESCROW_RELEASE_SYNC',
      { correlationId }
    );

    if (!transactionResult.success) {
      throw new Error(transactionResult.error);
    }

    const { txHash, receipt, beforeSnapshotId: snapshotId } = transactionResult.result;

    // Step 5: Create after snapshot (post-transaction)
    const afterSnapshotId = await StateSnapshotManager.createAfterSnapshot(
      'ESCROW_RELEASE',
      'INVOICE',
      invoiceId,
      {
        escrow_status: 'released',
        release_tx_hash: txHash,
        block_number: receipt.blockNumber,
      },
      snapshotId
    );

    // Step 6: Log audit trail
    await TransactionAuditTrail.logTransaction({
      correlationId,
      operationType: 'ESCROW_RELEASE_SYNC',
      entityType: 'INVOICE',
      entityId: invoiceId,
      action: 'RELEASE',
      actorId: userId,
      status: 'SUCCESS',
      metadata: {
        txHash,
        blockNumber: receipt.blockNumber,
        beforeSnapshotId: snapshotId,
        afterSnapshotId,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      transactionHash: txHash,
    });

    // Update transaction state to completed
    await updateTransactionState(correlationId, 'COMPLETED', {
      stepsCompleted: [
        'VALIDATE_INVOICE',
        'CREATE_SNAPSHOT_BEFORE',
        'BLOCKCHAIN_TX',
        'DB_UPDATE',
        'AUDIT_LOG',
        'CREATE_SNAPSHOT_AFTER',
      ],
    });

    // Record idempotency key
    const result = {
      success: true,
      txHash,
      correlationId,
      blockNumber: receipt.blockNumber,
    };

    await IdempotencyKeyManager.recordKey(
      idempotencyKey,
      'ESCROW_RELEASE_SYNC',
      { invoiceId, userId },
      result
    );

    // Emit socket event if available
    if (io) {
      io.to(`invoice-${invoiceId}`).emit('escrow:released', {
        invoiceId,
        txHash,
      });
    }

    return res.json(result);
  } catch (error) {
    logger.error('Error in releaseEscrowSync:', {
      error: error.message,
      correlationId,
      stack: error.stack,
    });

    // Log failure to audit trail and recovery queue
    if (correlationId) {
      try {
        await updateTransactionState(correlationId, 'FAILED', {
          error: error.message,
        });

        await addToRecoveryQueue(
          correlationId,
          {
            operationType: 'ESCROW_RELEASE_SYNC',
            invoiceId: req.body.invoiceId,
            userId: req.user?.id,
            lastError: error.message,
          },
          0,
          error.message
        );
      } catch (logError) {
        logger.error('Failed to log transaction failure:', logError);
      }
    }

    return errorResponse(res, error, 500);
  }
};

/**
 * Raise dispute with full transaction boundaries
 */
exports.raiseDispute = async (req, res) => {
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
        error: `Cannot dispute escrow in ${invoice.escrow_status} state`,
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DISPUTE, {
      invoiceId,
      reason,
      userId,
    });

    // Log audit trail
    await TransactionAuditTrail.logTransaction({
      operationType: 'ESCROW_DISPUTE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      action: 'QUEUE_JOB',
      actorId: userId,
      status: 'INITIATED',
      metadata: { jobId: job.jobId, reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    res.json({
      success: true,
      jobId: job.jobId,
      message: 'Dispute queued for processing',
      invoiceId,
    });
  } catch (error) {
    logger.error('Error in raiseDispute:', { error: error.message });
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

    // Validate escrow state for deposit
    if (!['pending', 'created'].includes(invoice.escrow_status)) {
      return res.status(400).json({
        error: `Cannot deposit escrow in ${invoice.escrow_status} state`,
      });
    }

    // Add job to queue
    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DEPOSIT, {
      invoiceId,
      amount,
      tokenAddress,
      userId,
    });

    // Log audit trail
    await TransactionAuditTrail.logTransaction({
      operationType: 'ESCROW_DEPOSIT',
      entityType: 'INVOICE',
      entityId: invoiceId,
      action: 'QUEUE_JOB',
      actorId: userId,
      status: 'INITIATED',
      metadata: { jobId: job.jobId, amount, tokenAddress },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return res.json({
      success: true,
      jobId: job.jobId,
      message: 'Deposit queued for processing',
      invoiceId,
    });
  } catch (error) {
    logger.error('depositEscrow failed', { error: error.message });
    return errorResponse(res, error.message, 500);
  }
};

/**
 * Get job status
 */
exports.getJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const jobStatus = await blockchainQueue.getJobStatus(jobId);

    if (!jobStatus) {
      return errorResponse(res, 'Job not found', 404);
    }

    return res.json(jobStatus);
  } catch (error) {
    logger.error('Error in getJobStatus:', error);
    return errorResponse(res, error, 500);
  }
};

module.exports = exports;
