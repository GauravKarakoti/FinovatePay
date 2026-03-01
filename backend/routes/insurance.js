const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { contractAddresses } = require('../config/blockchain');
const insuranceService = require('../services/insuranceService');
const { pool } = require('../config/database');
const { logAudit } = require('../middleware/auditLogger');
const errorResponse = require('../utils/errorResponse');

// Helper: UUID → bytes32 (ethers v6)
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

// Helper: bytes32 → UUID
const bytes32ToUuid = (bytes32) => {
  const hex = bytes32.slice(2).padEnd(32, '0');
  const parts = hex.match(/.{1,8}/g);
  return parts.map((part, i) => {
    if (i === 0) return part;
    if (i === 2) return part.slice(0, 4) + '-' + part.slice(4);
    return part.slice(0, 4) + '-' + part.slice(4);
  }).join('-').toLowerCase();
};

// All insurance routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

/**
 * GET /api/insurance/config
 * Get insurance premium configuration
 */
router.get('/config', async (req, res) => {
  try {
    // Try to get from chain first
    let config = await insuranceService.getPremiumConfig();

    // Fall back to database config
    if (!config) {
      const dbConfig = await insuranceService.getInsuranceConfig();
      if (dbConfig) {
        config = {
          basePremiumBps: dbConfig.base_premium_bps.toString(),
          durationMultiplierBps: dbConfig.duration_multiplier_bps.toString(),
          maxCoverageAmount: dbConfig.max_coverage,
          minCoverageAmount: dbConfig.min_coverage
        };
      }
    }

    // Default fallback
    if (!config) {
      config = {
        basePremiumBps: '200',
        durationMultiplierBps: '50',
        maxCoverageAmount: '1000000000000000000000000',
        minCoverageAmount: '100000000000000000000'
      };
    }

    res.json({
      success: true,
      config
    });
  } catch (error) {
    console.error('Error getting insurance config:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/insurance/calculate-premium
 * Calculate premium for given coverage and duration
 */
router.get('/calculate-premium', async (req, res) => {
  try {
    const { coverageAmount, durationSeconds } = req.query;

    if (!coverageAmount || !durationSeconds) {
      return errorResponse(res, 'coverageAmount and durationSeconds are required', 400);
    }

    // Try chain calculation first
    let premium = await insuranceService.calculatePremiumOnChain(
      coverageAmount,
      durationSeconds
    );

    // Fall back to local calculation
    if (!premium) {
      premium = await insuranceService.calculatePremiumLocally(
        coverageAmount,
        durationSeconds
      );
    }

    res.json({
      success: true,
      coverageAmount,
      durationSeconds,
      premium
    });
  } catch (error) {
    console.error('Error calculating premium:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/insurance/purchase
 * Purchase insurance for an escrow
 */
router.post('/purchase', requireRole(['buyer', 'seller', 'investor']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { invoiceId, coverageAmount, durationSeconds, paymentToken } = req.body;
    const userWallet = req.user.wallet_address;

    if (!invoiceId || !coverageAmount || !durationSeconds) {
      return errorResponse(res, 'invoiceId, coverageAmount, and durationSeconds are required', 400);
    }

    await client.query('BEGIN');

    // Check if invoice exists
    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Check if user is authorized (buyer or seller)
    if (invoice.buyer_address.toLowerCase() !== userWallet.toLowerCase() &&
        invoice.seller_address.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Not authorized to insure this invoice');
    }

    // Check if insurance already exists for this invoice
    const existingPolicies = await insuranceService.getPoliciesByInvoice(invoiceId);
    const activePolicy = existingPolicies.find(p => p.status === 'active');

    if (activePolicy) {
      throw new Error('Active insurance already exists for this invoice');
    }

    // Convert invoiceId to bytes32 for chain
    const invoiceIdBytes = uuidToBytes32(invoiceId);

    // Get premium
    let premium = await insuranceService.calculatePremiumLocally(coverageAmount, durationSeconds);

    // Purchase on chain
    const chainResult = await insuranceService.purchaseInsuranceOnChain(
      invoiceIdBytes,
      coverageAmount,
      durationSeconds,
      paymentToken || ethers.ZeroAddress
    );

    // Save to database
    const policyData = {
      policy_id: chainResult.policyId,
      invoice_id: invoiceId,
      insured_address: userWallet,
      coverage_amount: coverageAmount.toString(),
      premium_paid: premium,
      duration_seconds: parseInt(durationSeconds),
      start_time: new Date(),
      end_time: new Date(Date.now() + parseInt(durationSeconds) * 1000),
      status: 'active',
      tx_hash: chainResult.txHash
    };

    const savedPolicy = await insuranceService.createPolicy(policyData);

    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`invoice-${invoiceId}`).emit('insurance:purchased', {
        invoiceId,
        policyId: chainResult.policyId,
        coverageAmount,
        premium,
        insuredAddress: userWallet
      });
    }

    await logAudit({
      operationType: 'INSURANCE_PURCHASE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: userWallet,
      actorRole: req.user.role,
      action: 'CREATE',
      status: 'SUCCESS',
      newValues: { policyId: chainResult.policyId, coverageAmount, premium },
      metadata: { blockchain_tx: chainResult.txHash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      policyId: chainResult.policyId,
      coverageAmount,
      premium,
      durationSeconds,
      txHash: chainResult.txHash,
      startTime: policyData.start_time,
      endTime: policyData.end_time
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error purchasing insurance:', error);

    await logAudit({
      operationType: 'INSURANCE_PURCHASE',
      entityType: 'INVOICE',
      entityId: req.body.invoiceId,
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
 * GET /api/insurance/policies
 * Get user's insurance policies
 */
router.get('/policies', async (req, res) => {
  try {
    const userWallet = req.user.wallet_address;
    
    const policies = await insuranceService.getPoliciesByAddress(userWallet);

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Error getting policies:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/insurance/policy/:policyId
 * Get specific policy details
 */
router.get('/policy/:policyId', async (req, res) => {
  try {
    const { policyId } = req.params;
    const userWallet = req.user.wallet_address;

    // Get from database first
    let policy = await insuranceService.getPolicy(policyId);

    if (!policy) {
      // Try getting from chain
      const chainPolicy = await insuranceService.getPolicyFromChain(policyId);
      if (!chainPolicy) {
        return errorResponse(res, 'Policy not found', 404);
      }
      policy = chainPolicy;
    }

    // Check authorization
    if (policy.insured_address && 
        policy.insured_address.toLowerCase() !== userWallet.toLowerCase() &&
        req.user.role !== 'admin') {
      return errorResponse(res, 'Not authorized to view this policy', 403);
    }

    // Get associated claims
    const claims = await insuranceService.getClaimsByPolicy(policyId);

    res.json({
      success: true,
      policy,
      claims
    });
  } catch (error) {
    console.error('Error getting policy:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/insurance/invoice/:invoiceId
 * Get insurance policies for an invoice
 */
router.get('/invoice/:invoiceId', async (req, res) => {
  try {
    const { invoiceId } = req.params;

    const policies = await insuranceService.getPoliciesByInvoice(invoiceId);

    res.json({
      success: true,
      policies
    });
  } catch (error) {
    console.error('Error getting invoice policies:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * POST /api/insurance/claim
 * File a claim on an insurance policy
 */
router.post('/claim', requireRole(['buyer', 'seller', 'investor']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { policyId, reason, evidence } = req.body;
    const userWallet = req.user.wallet_address;

    if (!policyId || !reason) {
      return errorResponse(res, 'policyId and reason are required', 400);
    }

    const validReasons = ['counterparty_default', 'smart_contract_failure', 'force_majeure'];
    if (!validReasons.includes(reason)) {
      return errorResponse(res, 'Invalid reason. Must be one of: ' + validReasons.join(', '), 400);
    }

    await client.query('BEGIN');

    // Get policy
    const policy = await insuranceService.getPolicy(policyId);

    if (!policy) {
      throw new Error('Policy not found');
    }

    // Check authorization
    if (policy.insured_address.toLowerCase() !== userWallet.toLowerCase()) {
      throw new Error('Not authorized to file claim on this policy');
    }

    if (policy.status !== 'active') {
      throw new Error('Policy is not active');
    }

    // Check if claim already exists
    const existingClaims = await insuranceService.getClaimsByPolicy(policyId);
    const pendingClaim = existingClaims.find(c => c.status === 'pending' || c.status === 'approved');

    if (pendingClaim) {
      throw new Error('A claim is already pending for this policy');
    }

    // Generate claim ID
    const claimId = ethers.keccak256(
      ethers.solidityPacked(
        ['bytes32', 'address', 'uint256'],
        [policyId, userWallet, Date.now()]
      )
    );

    // Create claim in database
    const claimData = {
      claim_id: claimId,
      policy_id: policyId,
      invoice_id: policy.invoice_id,
      claimant_address: userWallet,
      reason,
      evidence: evidence || '',
      requested_amount: policy.coverage_amount,
      status: 'pending'
    };

    await insuranceService.createClaim(claimData);

    // Update policy status
    await insuranceService.updatePolicyStatus(policyId, 'claimed', {
      claim_reason: reason,
      claim_evidence: evidence || ''
    });

    // File claim on chain
    const chainResult = await insuranceService.fileClaimOnChain(
      policyId,
      reason,
      evidence || ''
    );

    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`invoice-${policy.invoice_id}`).emit('insurance:claim-filed', {
        policyId,
        claimId,
        reason,
        invoiceId: policy.invoice_id
      });
    }

    await logAudit({
      operationType: 'INSURANCE_CLAIM',
      entityType: 'INSURANCE_POLICY',
      entityId: policyId,
      actorId: req.user.id,
      actorWallet: userWallet,
      actorRole: req.user.role,
      action: 'CREATE',
      status: 'SUCCESS',
      newValues: { claimId, reason, requestedAmount: policy.coverage_amount },
      metadata: { blockchain_tx: chainResult.txHash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      claimId,
      policyId,
      reason,
      requestedAmount: policy.coverage_amount,
      status: 'pending',
      txHash: chainResult.txHash
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error filing claim:', error);

    await logAudit({
      operationType: 'INSURANCE_CLAIM',
      entityType: 'INSURANCE_POLICY',
      entityId: req.body.policyId,
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
 * POST /api/insurance/approve-claim
 * Approve a claim (admin only)
 */
router.post('/approve-claim', requireRole(['admin']), async (req, res) => {
  const client = await pool.connect();

  try {
    const { claimId, approvedAmount, payoutToken } = req.body;
    const adminWallet = req.user.wallet_address;

    if (!claimId || !approvedAmount) {
      return errorResponse(res, 'claimId and approvedAmount are required', 400);
    }

    await client.query('BEGIN');

    // Get claim
    const claim = await insuranceService.getClaim(claimId);

    if (!claim) {
      throw new Error('Claim not found');
    }

    if (claim.status !== 'pending') {
      throw new Error('Claim is not pending');
    }

    // Get policy
    const policy = await insuranceService.getPolicy(claim.policy_id);

    if (!policy) {
      throw new Error('Policy not found');
    }

    // Approve on chain
    const chainResult = await insuranceService.approveClaimOnChain(
      claim.policy_id,
      approvedAmount,
      payoutToken || ethers.ZeroAddress
    );

    // Update claim status
    await insuranceService.updateClaimStatus(claimId, 'approved', {
      approved_amount: approvedAmount,
      reviewer_address: adminWallet
    });

    // Update policy status
    await insuranceService.updatePolicyStatus(claim.policy_id, 'claimed', {
      claim_approved: true,
      claim_amount: approvedAmount,
      payout_tx_hash: chainResult.txHash
    });

    await client.query('COMMIT');

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to(`invoice-${claim.invoice_id}`).emit('insurance:claim-approved', {
        claimId,
        policyId: claim.policy_id,
        approvedAmount,
        invoiceId: claim.invoice_id
      });
    }

    await logAudit({
      operationType: 'INSURANCE_CLAIM_APPROVAL',
      entityType: 'INSURANCE_CLAIM',
      entityId: claimId,
      actorId: req.user.id,
      actorWallet: adminWallet,
      actorRole: req.user.role,
      action: 'APPROVE',
      status: 'SUCCESS',
      newValues: { approvedAmount, payoutToken },
      metadata: { blockchain_tx: chainResult.txHash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({
      success: true,
      claimId,
      policyId: claim.policy_id,
      approvedAmount,
      txHash: chainResult.txHash
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error approving claim:', error);

    await logAudit({
      operationType: 'INSURANCE_CLAIM_APPROVAL',
      entityType: 'INSURANCE_CLAIM',
      entityId: req.body.claimId,
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
 * GET /api/insurance/stats
 * Get insurance statistics (admin only)
 */
router.get('/stats', requireRole(['admin']), async (req, res) => {
  try {
    const stats = await insuranceService.getInsuranceStats();

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    console.error('Error getting insurance stats:', error);
    return errorResponse(res, error.message, 500);
  }
});

/**
 * GET /api/insurance/claims
 * Get all pending claims (admin only)
 */
router.get('/claims', requireRole(['admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.*, p.coverage_amount, p.premium_paid, p.invoice_id 
       FROM insurance_claims c
       JOIN insurance_policies p ON c.policy_id = p.policy_id
       WHERE c.status = 'pending'
       ORDER BY c.created_at DESC`
    );

    res.json({
      success: true,
      claims: result.rows
    });
  } catch (error) {
    console.error('Error getting claims:', error);
    return errorResponse(res, error.message, 500);
  }
});

module.exports = router;
