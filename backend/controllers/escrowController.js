const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { logAudit, logFinancialTransaction } = require('../middleware/auditLogger');

// Helper function to convert UUID to bytes32 using ethers v6 syntax
const uuidToBytes32 = (uuid) => {
  // 1. Remove hyphens and prepend '0x'
  const hex = '0x' + uuid.replace(/-/g, '');
  // 2. Pad to 32 bytes
  return ethers.zeroPadValue(hex, 32);
};

exports.releaseEscrow = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { invoiceId } = req.body;
    const io = req.app.get("io");

    await client.query('BEGIN');

    // Get invoice details with lock
    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Check if already released
    if (invoice.escrow_status === 'released') {
      throw new Error('Escrow already released');
    }

    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // Log financial transaction as PENDING
    const financialTx = await logFinancialTransaction({
      transactionType: 'ESCROW_RELEASE',
      invoiceId,
      fromAddress: invoice.buyer_address,
      toAddress: invoice.seller_address,
      amount: invoice.amount,
      status: 'PENDING',
      initiatedBy: req.user.id,
      metadata: { reason: 'Escrow release confirmed' }
    });

    const tx = await escrowContract.confirmRelease(bytes32InvoiceId);
    await tx.wait();

    await client.query(
      'UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3',
      ['released', tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    // Update financial transaction to CONFIRMED
    if (financialTx) {
      await pool.query(
        'UPDATE financial_transactions SET status = $1, blockchain_tx_hash = $2, confirmed_at = NOW() WHERE transaction_id = $3',
        ['CONFIRMED', tx.hash, financialTx.transaction_id]
      );
    }

    // Log audit entry
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
      metadata: { blockchain_tx: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    // Real-time event
    io.to(`invoice-${invoiceId}`).emit("escrow:released", {
      invoiceId,
      txHash: tx.hash,
      status: "released"
    });

    res.json({ success: true, txHash: tx.hash });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error in releaseEscrow:", error);

    // Log failed audit entry
    await logAudit({
      operationType: 'ESCROW_RELEASE',
      entityType: 'INVOICE',
      entityId: req.body.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'RELEASE',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

exports.raiseDispute = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { invoiceId, reason } = req.body;
    const io = req.app.get("io");

    await client.query('BEGIN');

    // Get invoice details with lock
    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Check if already disputed
    if (invoice.escrow_status === 'disputed') {
      throw new Error('Dispute already raised');
    }

    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    const tx = await escrowContract.raiseDispute(bytes32InvoiceId);
    await tx.wait();

    await client.query(
      'UPDATE invoices SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3 WHERE invoice_id = $4',
      ['disputed', reason, tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    // Log audit entry
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
      newValues: { escrow_status: 'disputed', dispute_reason: reason, tx_hash: tx.hash },
      metadata: { blockchain_tx: tx.hash, reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    // Real-time event
    io.to(`invoice-${invoiceId}`).emit("escrow:dispute", {
      invoiceId,
      reason,
      txHash: tx.hash,
      status: "disputed"
    });

    res.json({ success: true, txHash: tx.hash });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error in raiseDispute:", error);

    // Log failed audit entry
    await logAudit({
      operationType: 'ESCROW_DISPUTE',
      entityType: 'INVOICE',
      entityId: req.body.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'RAISE_DISPUTE',
      status: 'FAILED',
      errorMessage: error.message,
      metadata: { reason: req.body.reason },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};