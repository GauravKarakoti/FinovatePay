const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
// Import getProvider as well
const { contractAddresses, getSigner, getProvider } = require('../config/blockchain');
const extractAbi = (artifact) => {
  return artifact.abi || (artifact.interface && artifact.interface.fragments) || artifact;
};
const EscrowContractArtifact = extractAbi(require('../../deployed/EscrowContract.json'));
const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');
const { errorResponse } = require('../utils/errorResponse');
const fraudDetectionService = require('../services/fraudDetectionService');

// Helper: UUID → bytes32
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

/**
 * Updated helper to handle async signers and sync providers correctly.
 * Use provider for GET (read) routes and signer for POST (write) routes.
 */
const getEscrowContract = (runner) => {
  return new ethers.Contract(
    contractAddresses.escrowContract,
    EscrowContractArtifact,
    runner || getProvider() // Fallback to sync provider instead of promise
  );
};

// All escrow routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

const runFraudGate = async ({ req, transactionType, amount, currency, invoiceId, context }) => {
  try {
    const result = await fraudDetectionService.evaluateTransactionRisk({
      userId: req.user?.id,
      walletAddress: req.user?.wallet_address,
      invoiceId,
      transactionType,
      amount,
      currency,
      context: {
        ...(context || {}),
        endpoint: req.originalUrl,
        method: req.method,
        actorRole: req.user?.role,
        kycStatus: req.user?.kyc_status || 'unknown'
      }
    });
    fraudDetectionService.ensureTransactionAllowed(result);
    return result;
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      throw error;
    }
    console.error('[EscrowRoutes] Fraud gate degraded:', error.message);
    return null;
  }
};

router.post('/multi-party', requireRole(['seller', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { invoiceId, durationSeconds } = req.body;
    if (!invoiceId) return errorResponse(res, 'invoiceId is required', 400);

    await client.query('BEGIN');
    const invoiceResult = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [invoiceId]);
    if (!invoiceResult.rows.length) throw new Error('Invoice not found');

    const invoice = invoiceResult.rows[0];
    if (invoice.seller_address.toLowerCase() !== req.user.wallet_address.toLowerCase() && req.user.role !== 'admin') {
      throw new Error('Not authorized');
    }

    // Await the signer before passing to contract
    const signer = await getSigner();
    const escrowContract = getEscrowContract(signer);
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    const duration = Number(durationSeconds) || 7 * 24 * 60 * 60;
    const tokenAddress = invoice.token_address || ethers.ZeroAddress;

    const tx = await escrowContract.createEscrow(
      bytes32InvoiceId, invoice.seller_address, invoice.buyer_address,
      invoice.amount, tokenAddress, duration, ethers.ZeroAddress, 0, 0, 0
    );

    await tx.wait();
    await client.query('UPDATE invoices SET escrow_status = $1, escrow_tx_hash = $2 WHERE invoice_id = $3', ['created', tx.hash, invoiceId]);
    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`invoice-${invoiceId}`).emit('escrow:created', { invoiceId, txHash: tx.hash });
    }

    await logAudit({
      operationType: 'ESCROW_CREATE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'CREATE',
      status: 'SUCCESS',
      newValues: { escrow_tx_hash: tx.hash },
      metadata: { blockchain_tx: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return res.json({ success: true, txHash: tx.hash });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === 'FRAUD_BLOCKED') {
      return res.status(error.statusCode || 403).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    console.error('Error creating multi-party escrow:', error);

    await logAudit({
      operationType: 'ESCROW_CREATE',
      entityType: 'INVOICE',
      entityId: req.body?.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'CREATE',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
});

router.post('/:invoiceId/approve', requireRole(['buyer', 'seller', 'admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    const { invoiceId } = req.params;
    const userWallet = req.user.wallet_address;

    await client.query('BEGIN');
    const invoiceResult = await client.query('SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE', [invoiceId]);
    if (!invoiceResult.rows.length) throw new Error('Invoice not found');

    const signer = await getSigner();
    const escrowContract = getEscrowContract(signer);
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // FIXED: Destructuring order to [approvers, approvalCount, required]
    const [approvers, approvalCount, required] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);
    const hasApproved = approvers.some(a => a.toLowerCase() === userWallet.toLowerCase());
    
    if (hasApproved) throw new Error('You have already approved this escrow');

    const tx = await escrowContract.addMultiSigApproval(bytes32InvoiceId);
    await tx.wait();

    // FIXED: Destructuring order for update check
    const [updatedApprovers, updatedApprovalCount, updatedRequired] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    await client.query('COMMIT');

    // Check release threshold
    if (Number(updatedApprovalCount) >= Number(updatedRequired)) {
       await pool.query('UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3', ['released', tx.hash, invoiceId]);
    }

    await logAudit({
      operationType: 'ESCROW_MULTISIG_APPROVAL',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: userWallet,
      actorRole: req.user.role,
      action: 'APPROVE',
      status: 'SUCCESS',
      newValues: { 
        approvalCount: Number(updatedApprovalCount), 
        required: Number(updatedRequired),
        tx_hash: tx.hash 
      },
      metadata: { blockchain_tx: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      txHash: tx.hash,
      approvalCount: Number(updatedApprovalCount),
      required: Number(updatedRequired),
      isFullyApproved: Number(updatedApprovalCount) >= Number(updatedRequired)
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === 'FRAUD_BLOCKED') {
      return res.status(error.statusCode || 403).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    console.error('Error in approveMultiSig:', error);

    await logAudit({
      operationType: 'ESCROW_MULTISIG_APPROVAL',
      entityType: 'INVOICE',
      entityId: req.params.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'APPROVE',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
});

router.get('/:invoiceId/approvals', requireRole(['buyer', 'seller', 'admin', 'investor']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const invoiceResult = await pool.query('SELECT * FROM invoices WHERE invoice_id = $1', [invoiceId]);
    if (!invoiceResult.rows.length) throw new Error('Invoice not found');
    const invoice = invoiceResult.rows[0];

    const escrowContract = getEscrowContract(); // Uses provider
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // FIXED: Destructuring order to match contract returns
    const [approvers, approvalCount, required] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    const userWallet = req.user.wallet_address;
    const currentUserApproved = approvers.some(a => a.toLowerCase() === userWallet.toLowerCase());

    res.json({
      success: true,
      invoiceId,
      approvers: approvers.map(a => a.toLowerCase()),
      required: Number(required),
      approvalCount: Number(approvalCount),
      isFullyApproved: Number(approvalCount) >= Number(required),
      currentUserApproved,
      escrowStatus: invoice.escrow_status,
      sellerAddress: invoice.seller_address.toLowerCase(),
      buyerAddress: invoice.buyer_address.toLowerCase()
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

router.get('/:invoiceId/status', requireRole(['buyer', 'seller', 'admin', 'investor']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const invoiceResult = await pool.query('SELECT * FROM invoices WHERE invoice_id = $1', [invoiceId]);
    if (!invoiceResult.rows.length) throw new Error('Invoice not found');
    const invoice = invoiceResult.rows[0];

    const escrowContract = getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // FIXED: Call correct function checkMultiSigRequired instead of multiSigRequired
    const multiSigRequired = await escrowContract.checkMultiSigRequired(bytes32InvoiceId);

    // FIXED: Destructuring order
    const [approvers, approvalCount, required] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    res.json({
      success: true,
      invoiceId,
      escrowStatus: invoice.escrow_status,
      amount: invoice.amount,
      sellerAddress: invoice.seller_address.toLowerCase(),
      buyerAddress: invoice.buyer_address.toLowerCase(),
      multiSigRequired: !!multiSigRequired, // Returns boolean
      approvals: {
        approvers: approvers.map(a => a.toLowerCase()),
        required: Number(required),
        approvalCount: Number(approvalCount),
        isFullyApproved: Number(approvalCount) >= Number(required)
      }
    });
  } catch (error) {
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;
