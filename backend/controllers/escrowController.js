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
const logger = require('../utils/logger')('escrowController');

const MAX_DISPUTE_REASON_LENGTH = 1000;
const MIN_DISPUTE_REASON_LENGTH = 10;

/* -------------------------------------------------------------------------- */
/* HELPERS */
/* -------------------------------------------------------------------------- */

const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/* -------------------------------------------------------------------------- */
/* ASYNC ESCROW RELEASE */
/* -------------------------------------------------------------------------- */

exports.releaseEscrow = async (req, res) => {
  try {
    const { invoiceId } = req.body;
    const userId = req.user?.id;

    if (!invoiceId || typeof invoiceId !== 'string') {
      return errorResponse(res, 'Invalid invoiceId', 400);
    }

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      return errorResponse(res, 'Invoice not found', 404);
    }

    const invoice = invoiceResult.rows[0];

    if (!['deposited', 'confirmed'].includes(invoice.escrow_status)) {
      return errorResponse(
        res,
        `Cannot release escrow in ${invoice.escrow_status} state`,
        400
      );
    }

    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_RELEASE, {
      invoiceId,
      userId,
    });

    return res.json({
      success: true,
      jobId: job.jobId,
      message: 'Escrow release queued',
      invoiceId,
    });
  } catch (error) {
    logger.error('releaseEscrow failed', { error: error.message });
    return errorResponse(res, error.message, 500);
  }
};

/* -------------------------------------------------------------------------- */
/* SYNC ESCROW RELEASE */
/* -------------------------------------------------------------------------- */

exports.releaseEscrowSync = async (req, res) => {
  const client = await pool.connect();

  let correlationId = null;
  let stepsCompleted = [];
  let txHash = null;

  try {
    const { invoiceId } = req.body;

    if (!req.user?.id) {
      return errorResponse(res, 'User authentication required', 401);
    }

    const io = req.app.get('io');

    correlationId = await createTransactionState({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      stepsRemaining: ['BLOCKCHAIN_TX', 'DB_UPDATE', 'AUDIT_LOG'],
      initiatedBy: req.user.id,
    });

    await updateTransactionState(correlationId, 'PROCESSING');

    await client.query('BEGIN');

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id=$1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

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

    logger.error('releaseEscrowSync failed', {
      error: error.message,
      correlationId,
    });

    if (correlationId) {
      await addToRecoveryQueue(
        correlationId,
        {
          operationType: 'ESCROW_RELEASE',
          invoiceId: req.body.invoiceId,
          txHash,
          stepsCompleted,
        },
        0,
        error.message
      );

      await updateTransactionState(correlationId, 'FAILED');
    }

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};

/* -------------------------------------------------------------------------- */
/* RAISE DISPUTE (ASYNC) */
/* -------------------------------------------------------------------------- */

exports.raiseDispute = async (req, res) => {
  try {
    const { invoiceId, reason } = req.body;
    const userId = req.user?.id;

    if (!reason || reason.length < MIN_DISPUTE_REASON_LENGTH) {
      return errorResponse(res, 'Dispute reason too short', 400);
    }

    if (reason.length > MAX_DISPUTE_REASON_LENGTH) {
      return errorResponse(res, 'Dispute reason too long', 400);
    }

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id=$1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      return errorResponse(res, 'Invoice not found', 404);
    }

    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DISPUTE, {
      invoiceId,
      reason,
      userId,
    });

    return res.json({
      success: true,
      jobId: job.jobId,
      message: 'Dispute queued',
      invoiceId,
    });
  } catch (error) {
    logger.error('raiseDispute failed', { error: error.message });
    return errorResponse(res, error.message, 500);
  }
};

/* -------------------------------------------------------------------------- */
/* ESCROW DEPOSIT (ASYNC) */
/* -------------------------------------------------------------------------- */

exports.depositEscrow = async (req, res) => {
  try {
    const { invoiceId, amount, tokenAddress } = req.body;
    const userId = req.user?.id;

    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id=$1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      return errorResponse(res, 'Invoice not found', 404);
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.escrow_status !== 'pending') {
      return errorResponse(
        res,
        `Cannot deposit to escrow in ${invoice.escrow_status} state`,
        400
      );
    }

    const job = await blockchainQueue.addJob(JOB_TYPES.ESCROW_DEPOSIT, {
      invoiceId,
      amount,
      tokenAddress: tokenAddress || ethers.ZeroAddress,
      userId,
    });

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
    logger.error('getJobStatus failed', { error: error.message });
    return errorResponse(res, error.message, 500);
  }
};