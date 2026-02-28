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

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

// UUID → bytes32 (ethers v6 compatible)
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/* ======================================================
   RELEASE ESCROW
====================================================== */
exports.releaseEscrow = async (req, res) => {
  const client = await pool.connect();
  let correlationId = null;

  try {
    const { invoiceId } = req.body;
    const io = req.app.get('io');

    /* ---------------- Create transaction state ---------------- */

    correlationId = await createTransactionState({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      stepsRemaining: ['BLOCKCHAIN_TX', 'DB_UPDATE', 'AUDIT_LOG'],
      contextData: { invoiceId, userId: req.user.id },
      initiatedBy: req.user.id,
    });

    await updateTransactionState(correlationId, 'PROCESSING');
    await client.query('BEGIN');

    /* ---------------- Fetch invoice ---------------- */

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.escrow_status === 'released') {
      throw new Error('Escrow already released');
    }

    /* ---------------- Blockchain interaction ---------------- */

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

    await updateTransactionState(correlationId, 'PROCESSING', {
      stepsCompleted: ['BLOCKCHAIN_TX'],
      stepsRemaining: ['DB_UPDATE', 'AUDIT_LOG'],
      contextData: { invoiceId, txHash: tx.hash },
    });

    /* ---------------- Database update ---------------- */

    await client.query(
      `UPDATE invoices
       SET escrow_status = $1, release_tx_hash = $2
       WHERE invoice_id = $3`,
      ['released', tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    await updateTransactionState(correlationId, 'PROCESSING', {
      stepsCompleted: ['BLOCKCHAIN_TX', 'DB_UPDATE'],
      stepsRemaining: ['AUDIT_LOG'],
    });

    if (financialTx) {
      await pool.query(
        `UPDATE financial_transactions
         SET status = $1, blockchain_tx_hash = $2, confirmed_at = NOW()
         WHERE transaction_id = $3`,
        ['CONFIRMED', tx.hash, financialTx.transaction_id]
      );
    }

    /* ---------------- Audit log ---------------- */

    await logAudit({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'RELEASE',
      status: 'SUCCESS',
      oldValues: { escrow_status: invoice.escrow_status },
      newValues: { escrow_status: 'released', tx_hash: tx.hash },
      metadata: { blockchain_tx: tx.hash, correlationId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await updateTransactionState(correlationId, 'COMPLETED', {
      stepsCompleted: ['BLOCKCHAIN_TX', 'DB_UPDATE', 'AUDIT_LOG'],
    });

    /* ---------------- Realtime event ---------------- */

    io.to(`invoice-${invoiceId}`).emit('escrow:released', {
      invoiceId,
      txHash: tx.hash,
      status: 'released',
    });

    return res.json({ success: true, txHash: tx.hash, correlationId });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in releaseEscrow:', error);

    if (correlationId) {
      await addToRecoveryQueue(
        correlationId,
        {
          operationType: 'ESCROW_RELEASE',
          invoiceId: req.body.invoiceId,
          txHash: error.txHash || null,
          stepsCompleted: ['BLOCKCHAIN_TX'],
        },
        0,
        error.message
      );

      await updateTransactionState(correlationId, 'FAILED');
    }

    await logAudit({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: req.body?.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'RELEASE',
      status: 'FAILED',
      errorMessage: error.message,
      metadata: { correlationId },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};

/* ======================================================
   RAISE DISPUTE
====================================================== */
exports.raiseDispute = async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId, reason } = req.body;
    const io = req.app.get('io');

    await client.query('BEGIN');

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    if (invoice.escrow_status === 'disputed') {
      throw new Error('Dispute already raised');
    }

    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      getSigner()
    );

    const tx = await escrowContract.raiseDispute(
      uuidToBytes32(invoiceId)
    );
    await tx.wait();

    await client.query(
      `UPDATE invoices
       SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3
       WHERE invoice_id = $4`,
      ['disputed', reason, tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    await logAudit({
      operationType: 'ESCROW_DISPUTE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'RAISE_DISPUTE',
      status: 'SUCCESS',
      oldValues: { escrow_status: invoice.escrow_status },
      newValues: {
        escrow_status: 'disputed',
        dispute_reason: reason,
        tx_hash: tx.hash,
      },
      metadata: { blockchain_tx: tx.hash, reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    io.to(`invoice-${invoiceId}`).emit('escrow:dispute', {
      invoiceId,
      reason,
      txHash: tx.hash,
      status: 'disputed',
    });

    return res.json({ success: true, txHash: tx.hash });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in raiseDispute:', error);

    await logAudit({
      operationType: 'ESCROW_DISPUTE',
      entityType: 'INVOICE',
      entityId: req.body?.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'RAISE_DISPUTE',
      status: 'FAILED',
      errorMessage: error.message,
      metadata: { reason: req.body?.reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};