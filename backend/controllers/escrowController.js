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
const logger = require('../utils/logger')('escrowController');

// Constants for validation
const MAX_DISPUTE_REASON_LENGTH = 1000;
const MIN_DISPUTE_REASON_LENGTH = 10;

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
  let stepsCompleted = []; // Track actual progress for recovery
  let txHash = null; // Track tx hash if blockchain tx succeeds

  try {
    const { invoiceId } = req.body;
    
    // Input validation
    if (!invoiceId || typeof invoiceId !== 'string') {
      logger.warn('releaseEscrow called with invalid invoiceId', { invoiceId });
      return errorResponse(res, 'Invalid invoiceId: Must be a non-empty string', 400);
    }

    if (!req.user || !req.user.id) {
      logger.error('releaseEscrow called without authenticated user');
      return errorResponse(res, 'User authentication required', 401);
    }

    const io = req.app.get('io');
    if (!io) {
      logger.warn('Socket.io instance not available');
    }

    /* ---------------- Create transaction state ---------------- */

    try {
      correlationId = await createTransactionState({
        operationType: 'ESCROW_RELEASE',
        entityType: 'INVOICE',
        entityId: invoiceId,
        stepsRemaining: ['BLOCKCHAIN_TX', 'DB_UPDATE', 'AUDIT_LOG'],
        contextData: { invoiceId, userId: req.user.id },
        initiatedBy: req.user.id,
      });
    } catch (txStateError) {
      logger.error('Failed to create transaction state', { error: txStateError.message });
      throw new Error(`Transaction state creation failed: ${txStateError.message}`);
    }

    await updateTransactionState(correlationId, 'PROCESSING');
    await client.query('BEGIN');

    /* ---------------- Fetch invoice ---------------- */

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows || invoiceResult.rows.length === 0) {
      logger.warn('Invoice not found', { invoiceId });
      throw new Error(`Invoice with ID ${invoiceId} not found`);
    }

    const invoice = invoiceResult.rows[0];
    
    // Validate invoice state
    if (!invoice.escrow_status) {
      logger.error('Invoice missing escrow_status field', { invoiceId });
      throw new Error('Invalid invoice state: missing escrow_status');
    }

    if (invoice.escrow_status === 'released') {
      logger.info('Escrow already released', { invoiceId });
      throw new Error('Escrow already released for this invoice');
    }

    // Validate required invoice fields
    if (!invoice.buyer_address || !invoice.seller_address) {
      logger.error('Invoice missing address fields', { invoiceId });
      throw new Error('Invalid invoice: missing buyer or seller address');
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

    // Mark blockchain step as completed only after successful tx
    stepsCompleted = ['BLOCKCHAIN_TX'];
    txHash = tx.hash;

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

    // Mark DB update step as completed after successful commit
    stepsCompleted = ['BLOCKCHAIN_TX', 'DB_UPDATE'];

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

    /* ---------------- Blockchain interaction ---------------- */

    try {
      const escrowContract = new ethers.Contract(
        contractAddresses.escrowContract,
        EscrowContractArtifact.abi,
        getSigner()
      );

      if (!escrowContract) {
        throw new Error('Failed to initialize escrow contract');
      }

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
      
      if (!tx || !tx.hash) {
        throw new Error('Invalid blockchain transaction response');
      }

      logger.info(`Escrow release transaction sent: ${tx.hash}`, { invoiceId });
      
      await tx.wait();
      logger.info(`Escrow release transaction confirmed: ${tx.hash}`, { invoiceId });

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

      if (financialTx && financialTx.transaction_id) {
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

      if (io) {
        io.to(`invoice-${invoiceId}`).emit('escrow:released', {
          invoiceId,
          txHash: tx.hash,
          status: 'released',
        });
      }

      logger.info('Escrow released successfully', { invoiceId, txHash: tx.hash });
      return res.json({ success: true, txHash: tx.hash, correlationId });
    } catch (blockchainError) {
      logger.error('Blockchain operation failed', { error: blockchainError.message, invoiceId });
      throw new Error(`Blockchain operation failed: ${blockchainError.message}`);
    }

  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackErr => {
      logger.error('Rollback failed', { error: rollbackErr.message });
    });

    logger.error('releaseEscrow failed', { error: error.message, invoiceId: req.body?.invoiceId, correlationId });

    if (correlationId) {
      try {
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
      } catch (recoveryError) {
        logger.error('Failed to add to recovery queue', { error: recoveryError.message });
      }
      await addToRecoveryQueue(
        correlationId,
        {
          operationType: 'ESCROW_RELEASE',
          invoiceId: req.body.invoiceId,
          txHash: txHash, // Use tracked txHash (null if tx never happened)
          stepsCompleted: stepsCompleted, // Use actual progress, not hardcoded
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
    }).catch(auditError => {
      logger.error('Failed to log audit', { error: auditError.message });
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

    // Input validation
    if (!invoiceId || typeof invoiceId !== 'string') {
      logger.warn('raiseDispute called with invalid invoiceId', { invoiceId });
      return errorResponse(res, 'Invalid invoiceId: Must be a non-empty string', 400);
    }

    if (!reason || typeof reason !== 'string') {
      logger.warn('raiseDispute called without dispute reason', { invoiceId });
      return errorResponse(res, 'Dispute reason is required and must be a string', 400);
    }

    if (reason.length < MIN_DISPUTE_REASON_LENGTH) {
      logger.warn('Dispute reason too short', { invoiceId, reasonLength: reason.length });
      return errorResponse(res, `Dispute reason must be at least ${MIN_DISPUTE_REASON_LENGTH} characters`, 400);
    }

    if (reason.length > MAX_DISPUTE_REASON_LENGTH) {
      logger.warn('Dispute reason too long', { invoiceId, reasonLength: reason.length });
      return errorResponse(res, `Dispute reason must not exceed ${MAX_DISPUTE_REASON_LENGTH} characters`, 400);
    }

    if (!req.user || !req.user.id) {
      logger.error('raiseDispute called without authenticated user');
      return errorResponse(res, 'User authentication required', 401);
    }

    const io = req.app.get('io');
    if (!io) {
      logger.warn('Socket.io instance not available');
    }

    logger.info('Raising dispute on invoice', { invoiceId, userId: req.user.id });

    await client.query('BEGIN');

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows || invoiceResult.rows.length === 0) {
      logger.warn('Invoice not found for dispute', { invoiceId });
      throw new Error(`Invoice with ID ${invoiceId} not found`);
    }

    const invoice = invoiceResult.rows[0];

    // Validate invoice state
    if (!invoice.escrow_status) {
      logger.error('Invoice missing escrow_status field', { invoiceId });
      throw new Error('Invalid invoice state: missing escrow_status');
    }

    if (invoice.escrow_status === 'disputed') {
      logger.warn('Dispute already raised on invoice', { invoiceId });
      throw new Error('Dispute already raised for this invoice');
    }

    if (invoice.escrow_status === 'settled' || invoice.escrow_status === 'released') {
      logger.warn('Cannot raise dispute on already settled/released invoice', { invoiceId, status: invoice.escrow_status });
      throw new Error(`Cannot raise dispute on ${invoice.escrow_status} invoice`);
    }

    // Validate required invoice fields
    if (!invoice.buyer_address || !invoice.seller_address) {
      logger.error('Invoice missing address fields', { invoiceId });
      throw new Error('Invalid invoice state: missing address fields');
    }

    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      getSigner()
    );

    if (!escrowContract) {
      logger.error('Failed to initialize escrow contract');
      throw new Error('Failed to initialize escrow contract');
    }

    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    logger.info('Sending raiseDispute transaction to blockchain', { invoiceId });

    const tx = await escrowContract.raiseDispute(bytes32InvoiceId);
    
    if (!tx || !tx.hash) {
      throw new Error('Invalid blockchain transaction response');
    }

    logger.info(`Dispute transaction sent: ${tx.hash}`, { invoiceId });

    await tx.wait();
    
    logger.info(`Dispute transaction confirmed: ${tx.hash}`, { invoiceId });

    await client.query(
      `UPDATE invoices
       SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3, dispute_raised_at = NOW()
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
        dispute_tx_hash: tx.hash,
      },
      metadata: { blockchain_tx: tx.hash, reasonLength: reason.length },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(auditError => {
      logger.error('Failed to log audit for dispute', { error: auditError.message });
    });

    if (io) {
      io.to(`invoice-${invoiceId}`).emit('escrow:dispute', {
        invoiceId,
        reason: reason.substring(0, 200), // Limit reason in socket message
        txHash: tx.hash,
        status: 'disputed',
        raisedBy: req.user.id,
        raisedAt: new Date().toISOString()
      });
    }

    logger.info('Dispute raised successfully', { invoiceId, txHash: tx.hash });

    return res.json({ success: true, txHash: tx.hash, invoiceId, raisedAt: new Date().toISOString() });

  } catch (error) {
    await client.query('ROLLBACK').catch(rollbackErr => {
      logger.error('Rollback failed during dispute raise', { error: rollbackErr.message });
    });

    logger.error('Error raising dispute', { 
      error: error.message, 
      invoiceId: req.body?.invoiceId,
      userId: req.user?.id,
      stack: error.stack
    });

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
      metadata: { reasonLength: req.body?.reason?.length },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    }).catch(auditError => {
      logger.error('Failed to log audit for failed dispute', { error: auditError.message });
    });

    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    if (error.message.includes('already raised') || error.message.includes('already settled')) statusCode = 400;
    if (error.message.includes('Invalid') || error.message.includes('missing')) statusCode = 400;

    return errorResponse(res, error.message || 'Failed to raise dispute', statusCode);
  } finally {
    client.release();
  }
};