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
const errorResponse = require('../utils/errorResponse');

// Helper: UUID → bytes32 (ethers v6)
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

// Get escrow contract instance
const getEscrowContract = (signer) => {
  return new ethers.Contract(
    contractAddresses.escrowContract,
    EscrowContractArtifact.abi,
    signer || getSigner()
  );
};

// All escrow routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

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
