const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { contractAddresses } = require('../config/blockchain');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');
const { errorResponse } = require('../utils/errorResponse');
const fraudDetectionService = require('../services/fraudDetectionService');

// Helper: UUID → bytes32 (ethers v6)
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

// Get escrow contract instance
const getEscrowContract = (signer) => {
  return new ethers.Contract(
    contractAddresses.escrowContract,
    EscrowContractArtifact,
    signer || getSigner()
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

/**
 * POST /api/escrow/multi-party
 * Create a multi-party escrow on-chain for an existing invoice
 */
router.post('/multi-party', requireRole(['seller', 'admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId, durationSeconds } = req.body;

    if (!invoiceId) {
      return errorResponse(res, 'invoiceId is required', 400);
    }

    await client.query('BEGIN');

    // Lock invoice row
    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Only seller or admin may create the on-chain escrow record
    if (invoice.seller_address.toLowerCase() !== req.user.wallet_address.toLowerCase() && req.user.role !== 'admin') {
      throw new Error('Not authorized to create escrow for this invoice');
    }

    const creationRisk = await runFraudGate({
      req,
      transactionType: 'escrow_create',
      amount: invoice.amount,
      currency: invoice.currency || 'USD',
      invoiceId,
      context: {
        escrowStatus: invoice.escrow_status,
        durationSeconds: Number(durationSeconds) || 7 * 24 * 60 * 60
      }
    });

    if (creationRisk?.shouldReview) {
      console.warn('[EscrowRoutes] Escrow creation flagged for review', {
        invoiceId,
        riskScore: creationRisk.riskScore
      });
    }

    const escrowContract = getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // Defaults: 7 days if not provided
    const duration = Number(durationSeconds) || 7 * 24 * 60 * 60;

    const tokenAddress = invoice.token_address || ethers.ZeroAddress;

    // Create on-chain escrow (onlyAdmin on contract side)
    const tx = await escrowContract.createEscrow(
      bytes32InvoiceId,
      invoice.seller_address,
      invoice.buyer_address,
      invoice.amount,
      tokenAddress,
      duration,
      ethers.ZeroAddress,
      0
    );

    await tx.wait();

    // Update DB status to reflect escrow creation
    await client.query(
      'UPDATE invoices SET escrow_status = $1, escrow_tx_hash = $2 WHERE invoice_id = $3',
      ['created', tx.hash, invoiceId]
    );

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

/**
 * POST /api/escrow/:invoiceId/approve
 * Add multi-signature approval for an escrow
 */
router.post('/:invoiceId/approve', requireRole(['buyer', 'seller', 'admin']), async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { invoiceId } = req.params;
    const userWallet = req.user.wallet_address;
    const io = req.app.get('io');

    await client.query('BEGIN');

    // Get invoice details
    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Verify user is authorized (buyer or seller)
    if (invoice.buyer_address.toLowerCase() !== userWallet.toLowerCase() && 
        invoice.seller_address.toLowerCase() !== userWallet.toLowerCase() &&
        req.user.role !== 'admin') {
      throw new Error('Not authorized to approve this escrow');
    }

    // Check escrow status - must be funded to approve
    if (invoice.escrow_status !== 'funded' && invoice.escrow_status !== 'deposited') {
      throw new Error('Escrow is not in funded state');
    }

    const approvalRisk = await runFraudGate({
      req,
      transactionType: 'escrow_approve',
      amount: invoice.amount,
      currency: invoice.currency || 'USD',
      invoiceId,
      context: {
        escrowStatus: invoice.escrow_status,
        approverRole: req.user.role
      }
    });

    if (approvalRisk?.shouldReview) {
      console.warn('[EscrowRoutes] Escrow approval flagged for review', {
        invoiceId,
        riskScore: approvalRisk.riskScore
      });
    }

    const escrowContract = getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    // Check if already approved by this user
    const [approvers, required, approvalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);
    const hasApproved = approvers.some(a => a.toLowerCase() === userWallet.toLowerCase());
    
    if (hasApproved) {
      throw new Error('You have already approved this escrow');
    }

    // Call contract to add approval
    const tx = await escrowContract.addMultiSigApproval(bytes32InvoiceId);
    const receipt = await tx.wait();

    // Get updated approval status
    const [updatedApprovers, updatedRequired, updatedApprovalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    await client.query('COMMIT');

    // Emit socket event
    io.to(`invoice-${invoiceId}`).emit('escrow:approval-added', {
      invoiceId,
      approver: userWallet,
      approvalCount: Number(updatedApprovalCount),
      required: Number(updatedRequired),
      txHash: tx.hash
    });

    // Check if escrow is now fully approved and released
    if (Number(updatedApprovalCount) >= Number(updatedRequired)) {
      io.to(`invoice-${invoiceId}`).emit('escrow:released', {
        invoiceId,
        txHash: tx.hash,
        status: 'released',
        message: 'Multi-signature threshold reached'
      });

      // Update database
      await pool.query(
        'UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3',
        ['released', tx.hash, invoiceId]
      );
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

/**
 * GET /api/escrow/:invoiceId/approvals
 * Get multi-signature approval status for an escrow
 */
router.get('/:invoiceId/approvals', requireRole(['buyer', 'seller', 'admin', 'investor']), async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Verify invoice exists
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Get multi-sig approval status from contract
    const escrowContract = getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    const [approvers, required, approvalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    // Get current user's approval status
    const userWallet = req.user.wallet_address;
    const currentUserApproved = approvers.some(
      a => a.toLowerCase() === userWallet.toLowerCase()
    );

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
    console.error('Error in getMultiSigApprovals:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/escrow/:invoiceId/status
 * Get full escrow status including multi-sig details
 */
router.get('/:invoiceId/status', requireRole(['buyer', 'seller', 'admin', 'investor']), async (req, res) => {
  try {
    const { invoiceId } = req.params;

    // Get invoice from database
    const invoiceResult = await pool.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Get multi-sig threshold from contract
    const escrowContract = getEscrowContract();
    const multiSigRequired = await escrowContract.multiSigRequired();

    // Get approval status
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    const [approvers, required, approvalCount] = await escrowContract.getMultiSigApprovals(bytes32InvoiceId);

    res.json({
      success: true,
      invoiceId,
      escrowStatus: invoice.escrow_status,
      amount: invoice.amount,
      sellerAddress: invoice.seller_address.toLowerCase(),
      buyerAddress: invoice.buyer_address.toLowerCase(),
      multiSigRequired: Number(multiSigRequired),
      approvals: {
        approvers: approvers.map(a => a.toLowerCase()),
        required: Number(required),
        approvalCount: Number(approvalCount),
        isFullyApproved: Number(approvalCount) >= Number(required)
      }
    });
  } catch (error) {
    console.error('Error in getEscrowStatus:', error);
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;
