const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { contractAddresses } = require('../config/blockchain');
const { pool } = require('../config/database');
const yieldPoolService = require('../services/yieldPoolService');
const { logAudit } = require('../middleware/auditLogger');
const errorResponse = require('../utils/errorResponse');

// Helper: UUID → bytes32
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

// All yield pool routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

/**
 * POST /api/yield/deposit/:invoiceId
 * Deposit funds from escrow into yield pool
 */
router.post('/deposit/:invoiceId', requireRole(['admin']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    // Get escrow contract and deposit to yield pool
    const escrowContract = yieldPoolService.getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    // Call contract to deposit to yield pool
    const tx = await escrowContract.depositToYieldPool(bytes32InvoiceId);
    const receipt = await tx.wait();
    
    // Record in database
    await yieldPoolService.depositToYieldPool(invoiceId, tx.hash);
    
    // Log audit
    await logAudit({
      operationType: 'YIELD_POOL_DEPOSIT',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'DEPOSIT_TO_YIELD',
      status: 'SUCCESS',
      metadata: { txHash: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Funds deposited to yield pool',
      txHash: tx.hash
    });
  } catch (error) {
    console.error('Error depositing to yield pool:', error);
    
    await logAudit({
      operationType: 'YIELD_POOL_DEPOSIT',
      entityType: 'INVOICE',
      entityId: req.params.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'DEPOSIT_TO_YIELD',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/yield/withdraw/:invoiceId
 * Withdraw funds from yield pool back to escrow
 */
router.post('/withdraw/:invoiceId', requireRole(['admin']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    const escrowContract = yieldPoolService.getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    // Call contract to withdraw from yield pool
    const tx = await escrowContract.withdrawFromYieldPool(bytes32InvoiceId);
    const receipt = await tx.wait();
    
    await logAudit({
      operationType: 'YIELD_POOL_WITHDRAW',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'WITHDRAW_FROM_YIELD',
      status: 'SUCCESS',
      metadata: { txHash: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Funds withdrawn from yield pool',
      txHash: tx.hash
    });
  } catch (error) {
    console.error('Error withdrawing from yield pool:', error);
    
    await logAudit({
      operationType: 'YIELD_POOL_WITHDRAW',
      entityType: 'INVOICE',
      entityId: req.params.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'WITHDRAW_FROM_YIELD',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/yield/claim/:invoiceId
 * Claim yield for an escrow (distribute to seller)
 */
router.post('/claim/:invoiceId', requireRole(['admin']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { sellerAddress } = req.body;
    
    if (!sellerAddress) {
      return res.status(400).json({ error: 'Seller address required' });
    }
    
    const escrowContract = yieldPoolService.getEscrowContract();
    const bytes32InvoiceId = uuidToBytes32(invoiceId);
    
    // Call contract to claim yield
    const tx = await escrowContract.claimYield(bytes32InvoiceId);
    const receipt = await tx.wait();
    
    // Get yield details from contract
    const yieldPoolContract = yieldPoolService.getYieldPoolContract();
    const depositDetails = await yieldPoolContract.getDepositDetails(bytes32InvoiceId);
    
    const principal = depositDetails.principal;
    const yieldEarned = depositDetails.yieldEarned;
    const claimed = depositDetails.claimed;
    const unclaimedYield = yieldEarned - claimed;
    
    // Calculate platform fee (5%) and seller yield (95%)
    const platformFee = unclaimedYield * 500n / 10000n;
    const sellerYield = unclaimedYield - platformFee;
    
    // Record in database
    await yieldPoolService.claimYield(
      invoiceId,
      sellerYield.toString(),
      platformFee.toString()
    );
    
    await logAudit({
      operationType: 'YIELD_CLAIM',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'CLAIM_YIELD',
      status: 'SUCCESS',
      metadata: { 
        txHash: tx.hash,
        sellerAddress,
        sellerYield: sellerYield.toString(),
        platformFee: platformFee.toString()
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    res.json({
      success: true,
      message: 'Yield claimed and distributed',
      txHash: tx.hash,
      sellerYield: sellerYield.toString(),
      platformFee: platformFee.toString()
    });
  } catch (error) {
    console.error('Error claiming yield:', error);
    
    await logAudit({
      operationType: 'YIELD_CLAIM',
      entityType: 'INVOICE',
      entityId: req.params.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'CLAIM_YIELD',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });
    
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/yield/info/:invoiceId
 * Get yield information for an invoice
 */
router.get('/info/:invoiceId', requireRole(['buyer', 'seller', 'admin']), async (req, res) => {
  try {
    const { invoiceId } = req.params;
    
    const yieldInfo = await yieldPoolService.getYieldInfo(invoiceId);
    
    res.json({
      success: true,
      ...yieldInfo
    });
  } catch (error) {
    console.error('Error getting yield info:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/yield/stats
 * Get global yield pool statistics
 */
router.get('/stats', requireRole(['admin']), async (req, res) => {
  try {
    const stats = await yieldPoolService.getPoolStats();
    
    res.json({
      success: true,
      ...stats
    });
  } catch (error) {
    console.error('Error getting pool stats:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/yield/escrows
 * Get all escrows in yield pool
 */
router.get('/escrows', requireRole(['admin']), async (req, res) => {
  try {
    const escrows = await yieldPoolService.getEscrowsInYieldPool();
    
    res.json({
      success: true,
      escrows
    });
  } catch (error) {
    console.error('Error getting escrows:', error);
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;
