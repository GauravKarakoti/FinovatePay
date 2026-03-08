const { ethers } = require('ethers');
const { getProvider, getSigner, contractAddresses } = require('../config/blockchain');
const { pool } = require('../config/database');

// EscrowInsurance contract ABI
const EscrowInsuranceABI = [
  // Enum
  "enum InsuranceStatus { Active, Claimed, Expired, Cancelled }",
  "enum ClaimReason { CounterpartyDefault, SmartContractFailure, ForceMajeure }",
  
  // Struct
  "struct InsurancePolicy { bytes32 policyId; bytes32 invoiceId; address insuredParty; uint256 coverageAmount; uint256 premiumPaid; uint256 duration; uint256 startTime; uint256 endTime; uint8 status; bool claimApproved; uint256 claimAmount; uint8 claimReason; string claimEvidence; }",
  
  // Read functions
  "function policies(bytes32) view returns (tuple(bytes32 policyId, bytes32 invoiceId, address insuredParty, uint256 coverageAmount, uint256 premiumPaid, uint256 duration, uint256 startTime, uint256 endTime, uint8 status, bool claimApproved, uint256 claimAmount, uint8 claimReason, string claimEvidence))",
  "function policyIds(bytes32) view returns (bool)",
  "function basePremiumBps() view returns (uint256)",
  "function durationMultiplierBps() view returns (uint256)",
  "function maxCoverageAmount() view returns (uint256)",
  "function minCoverageAmount() view returns (uint256)",
  "function treasury() view returns (address)",
  "function calculatePremium(uint256, uint256) view returns (uint256)",
  "function hasPolicy(bytes32) view returns (bool)",
  
  // Write functions
  "function insureEscrow(bytes32, uint256, uint256, address) returns (bytes32)",
  "function claimInsurance(bytes32, uint8, string)",
  "function approveClaim(bytes32, uint256, address)",
  "function cancelPolicy(bytes32)",
  "function checkAndExpire(bytes32)",
  "function setPremiumConfig(uint256, uint256)",
  "function setCoverageLimits(uint256, uint256)",
  "function setTreasury(address)",
  
  // Events
  "event PolicyCreated(bytes32 indexed, bytes32 indexed, address indexed, uint256, uint256, uint256)",
  "event PolicyClaimed(bytes32 indexed, bytes32 indexed, uint8, uint256)",
  "event ClaimApproved(bytes32 indexed, uint256)",
  "event PolicyCancelled(bytes32 indexed)",
  "event PolicyExpired(bytes32 indexed)",
  "event PremiumConfigUpdated(uint256, uint256, uint256, uint256)",
  "event CoverageLimitsUpdated(uint256, uint256, uint256, uint256)",
  "event TreasuryUpdated(address indexed, address indexed)"
];

let insuranceContract = null;

/**
 * Get EscrowInsurance contract instance
 */
const getInsuranceContract = (signerOrProvider) => {
  if (!contractAddresses.escrowInsurance) {
    console.warn("[InsuranceService] EscrowInsurance address not configured");
    return null;
  }

  try {
    const provider = signerOrProvider || getProvider();
    if (!provider) {
      throw new Error('Provider not available');
    }

    return new ethers.Contract(
      contractAddresses.escrowInsurance,
      EscrowInsuranceABI,
      provider
    );
  } catch (error) {
    console.error("[InsuranceService] Failed to get contract:", error.message);
    return null;
  }
};

/**
 * Get contract with signer for write operations
 */
const getInsuranceContractWithSigner = () => {
  const signer = getSigner();
  if (!signer) {
    throw new Error('Signer not available');
  }
  return getInsuranceContract(signer);
};

/**
 * Convert insurance status enum to string
 */
const statusToString = (status) => {
  const statusMap = ['active', 'claimed', 'expired', 'cancelled'];
  return statusMap[status] || 'active';
};

/**
 * Convert claim reason enum to string
 */
const reasonToString = (reason) => {
  const reasonMap = ['counterparty_default', 'smart_contract_failure', 'force_majeure'];
  return reasonMap[reason] || 'counterparty_default';
};

/**
 * Convert string to claim reason enum
 */
const stringToReason = (reason) => {
  const reasonMap = {
    'counterparty_default': 0,
    'smart_contract_failure': 1,
    'force_majeure': 2
  };
  return reasonMap[reason] || 0;
};

/**
 * Get premium configuration from chain
 */
const getPremiumConfig = async () => {
  const contract = getInsuranceContract();

  if (!contract) {
    return null;
  }

  try {
    const [basePremiumBps, durationMultiplierBps, maxCoverage, minCoverage] = await Promise.all([
      contract.basePremiumBps(),
      contract.durationMultiplierBps(),
      contract.maxCoverageAmount(),
      contract.minCoverageAmount()
    ]);

    return {
      basePremiumBps: basePremiumBps.toString(),
      durationMultiplierBps: durationMultiplierBps.toString(),
      maxCoverageAmount: maxCoverage.toString(),
      minCoverageAmount: minCoverage.toString()
    };
  } catch (error) {
    console.error("[InsuranceService] Error getting premium config:", error.message);
    return null;
  }
};

/**
 * Calculate premium for coverage
 */
const calculatePremiumOnChain = async (coverageAmount, durationSeconds) => {
  const contract = getInsuranceContract();

  if (!contract) {
    return null;
  }

  try {
    const premium = await contract.calculatePremium(coverageAmount, durationSeconds);
    return premium.toString();
  } catch (error) {
    console.error("[InsuranceService] Error calculating premium:", error.message);
    return null;
  }
};

/**
 * Purchase insurance on chain
 */
const purchaseInsuranceOnChain = async (
  invoiceId,
  coverageAmount,
  durationSeconds,
  paymentToken
) => {
  const contract = getInsuranceContractWithSigner();

  const overrides = paymentToken === ethers.ZeroAddress ? { value: coverageAmount } : {};

  const tx = await contract.insureEscrow(
    invoiceId,
    coverageAmount,
    durationSeconds,
    paymentToken,
    overrides
  );

  const receipt = await tx.wait();

  // Find PolicyCreated event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'PolicyCreated');

  return {
    txHash: tx.hash,
    policyId: event ? event.args.policyId : null,
    coverageAmount: event ? event.args.coverageAmount.toString() : null,
    premiumPaid: event ? event.args.premiumPaid.toString() : null
  };
};

/**
 * File a claim on chain
 */
const fileClaimOnChain = async (policyId, reason, evidence) => {
  const contract = getInsuranceContractWithSigner();

  const reasonEnum = stringToReason(reason);

  const tx = await contract.claimInsurance(policyId, reasonEnum, evidence);
  const receipt = await tx.wait();

  // Find PolicyClaimed event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'PolicyClaimed');

  return {
    txHash: tx.hash,
    claimAmount: event ? event.args.claimAmount.toString() : null
  };
};

/**
 * Approve a claim on chain
 */
const approveClaimOnChain = async (policyId, claimAmount, payoutToken) => {
  const contract = getInsuranceContractWithSigner();

  const tx = await contract.approveClaim(policyId, claimAmount, payoutToken);
  const receipt = await tx.wait();

  // Find ClaimApproved event
  const event = receipt.logs
    .map(log => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find(parsed => parsed?.name === 'ClaimApproved');

  return {
    txHash: tx.hash,
    approvedAmount: event ? event.args.approvedAmount.toString() : null
  };
};

/**
 * Get policy from chain
 */
const getPolicyFromChain = async (policyId) => {
  const contract = getInsuranceContract();

  if (!contract) {
    return null;
  }

  try {
    const policy = await contract.policies(policyId);

    return {
      policyId: policy.policyId,
      invoiceId: policy.invoiceId,
      insuredParty: policy.insuredParty,
      coverageAmount: policy.coverageAmount.toString(),
      premiumPaid: policy.premiumPaid.toString(),
      duration: policy.duration.toString(),
      startTime: new Date(policy.startTime * 1000),
      endTime: new Date(policy.endTime * 1000),
      status: statusToString(policy.status),
      claimApproved: policy.claimApproved,
      claimAmount: policy.claimAmount.toString(),
      claimReason: reasonToString(policy.claimReason),
      claimEvidence: policy.claimEvidence
    };
  } catch (error) {
    console.error("[InsuranceService] Error getting policy:", error.message);
    return null;
  }
};

/**
 * Check if policy exists on chain
 */
const hasPolicyOnChain = async (policyId) => {
  const contract = getInsuranceContract();

  if (!contract) {
    return false;
  }

  try {
    return await contract.hasPolicy(policyId);
  } catch (error) {
    console.error("[InsuranceService] Error checking policy:", error.message);
    return false;
  }
};

/*//////////////////////////////////////////////////////////////
                    DATABASE OPERATIONS
    //////////////////////////////////////////////////////////////*/

/**
 * Create insurance policy in database
 */
const createPolicy = async (policyData) => {
  const {
    policy_id,
    invoice_id,
    insured_address,
    coverage_amount,
    premium_paid,
    duration_seconds,
    start_time,
    end_time,
    status,
    tx_hash
  } = policyData;

  try {
    const result = await pool.query(
      `INSERT INTO insurance_policies 
       (policy_id, invoice_id, insured_address, coverage_amount, premium_paid, duration_seconds, start_time, end_time, status, claim_tx_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [policy_id, invoice_id, insured_address, coverage_amount, premium_paid, duration_seconds, start_time, end_time, status, tx_hash]
    );

    return result.rows[0];
  } catch (error) {
    console.error("[InsuranceService] Error creating policy:", error.message);
    throw error;
  }
};

/**
 * Get policy from database
 */
const getPolicy = async (policyId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_policies WHERE policy_id = $1',
      [policyId]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error("[InsuranceService] Error getting policy:", error.message);
    throw error;
  }
};

/**
 * Get policies by invoice ID
 */
const getPoliciesByInvoice = async (invoiceId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_policies WHERE invoice_id = $1 ORDER BY created_at DESC',
      [invoiceId]
    );

    return result.rows;
  } catch (error) {
    console.error("[InsuranceService] Error getting policies by invoice:", error.message);
    throw error;
  }
};

/**
 * Get policies by insured address
 */
const getPoliciesByAddress = async (insuredAddress) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_policies WHERE insured_address = $1 ORDER BY created_at DESC',
      [insuredAddress]
    );

    return result.rows;
  } catch (error) {
    console.error("[InsuranceService] Error getting policies by address:", error.message);
    throw error;
  }
};

/**
 * Get active policies
 */
const getActivePolicies = async (limit = 50) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_policies WHERE status = $1 ORDER BY created_at DESC LIMIT $2',
      ['active', limit]
    );

    return result.rows;
  } catch (error) {
    console.error("[InsuranceService] Error getting active policies:", error.message);
    throw error;
  }
};

/**
 * Update policy status
 */
const updatePolicyStatus = async (policyId, status, additionalFields = {}) => {
  const fields = ['status = $2'];
  const values = [policyId, status];
  let paramCount = 2;

  if (additionalFields.claim_approved !== undefined) {
    fields.push(`claim_approved = $${++paramCount}`);
    values.push(additionalFields.claim_approved);
  }

  if (additionalFields.claim_amount !== undefined) {
    fields.push(`claim_amount = $${++paramCount}`);
    values.push(additionalFields.claim_amount);
  }

  if (additionalFields.claim_reason !== undefined) {
    fields.push(`claim_reason = $${++paramCount}`);
    values.push(additionalFields.claim_reason);
  }

  if (additionalFields.claim_evidence !== undefined) {
    fields.push(`claim_evidence = $${++paramCount}`);
    values.push(additionalFields.claim_evidence);
  }

  if (additionalFields.payout_tx_hash !== undefined) {
    fields.push(`payout_tx_hash = $${++paramCount}`);
    values.push(additionalFields.payout_tx_hash);
  }

  try {
    const result = await pool.query(
      `UPDATE insurance_policies SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE policy_id = $1 RETURNING *`,
      values
    );

    return result.rows[0];
  } catch (error) {
    console.error("[InsuranceService] Error updating policy status:", error.message);
    throw error;
  }
};

/**
 * Create claim in database
 */
const createClaim = async (claimData) => {
  const {
    claim_id,
    policy_id,
    invoice_id,
    claimant_address,
    reason,
    evidence,
    requested_amount,
    status
  } = claimData;

  try {
    const result = await pool.query(
      `INSERT INTO insurance_claims 
       (claim_id, policy_id, invoice_id, claimant_address, reason, evidence, requested_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [claim_id, policy_id, invoice_id, claimant_address, reason, evidence, requested_amount, status]
    );

    return result.rows[0];
  } catch (error) {
    console.error("[InsuranceService] Error creating claim:", error.message);
    throw error;
  }
};

/**
 * Get claim by ID
 */
const getClaim = async (claimId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_claims WHERE claim_id = $1',
      [claimId]
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error("[InsuranceService] Error getting claim:", error.message);
    throw error;
  }
};

/**
 * Get claims by policy ID
 */
const getClaimsByPolicy = async (policyId) => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_claims WHERE policy_id = $1 ORDER BY created_at DESC',
      [policyId]
    );

    return result.rows;
  } catch (error) {
    console.error("[InsuranceService] Error getting claims by policy:", error.message);
    throw error;
  }
};

/**
 * Update claim status
 */
const updateClaimStatus = async (claimId, status, additionalFields = {}) => {
  const fields = ['status = $2'];
  const values = [claimId, status];
  let paramCount = 2;

  if (additionalFields.approved_amount !== undefined) {
    fields.push(`approved_amount = $${++paramCount}`);
    values.push(additionalFields.approved_amount);
  }

  if (additionalFields.reviewer_address !== undefined) {
    fields.push(`reviewer_address = $${++paramCount}`);
    values.push(additionalFields.reviewer_address);
  }

  if (additionalFields.review_notes !== undefined) {
    fields.push(`review_notes = $${++paramCount}`);
    values.push(additionalFields.review_notes);
  }

  if (additionalFields.tx_hash !== undefined) {
    fields.push(`tx_hash = $${++paramCount}`);
    values.push(additionalFields.tx_hash);
  }

  try {
    const result = await pool.query(
      `UPDATE insurance_claims SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE claim_id = $1 RETURNING *`,
      values
    );

    return result.rows[0];
  } catch (error) {
    console.error("[InsuranceService] Error updating claim status:", error.message);
    throw error;
  }
};

/**
 * Get insurance config from database
 */
const getInsuranceConfig = async () => {
  try {
    const result = await pool.query(
      'SELECT * FROM insurance_config WHERE is_active = TRUE LIMIT 1'
    );

    return result.rows[0] || null;
  } catch (error) {
    console.error("[InsuranceService] Error getting insurance config:", error.message);
    throw error;
  }
};

/**
 * Calculate premium locally
 */
const calculatePremiumLocally = async (coverageAmount, durationSeconds) => {
  const config = await getInsuranceConfig();

  if (!config) {
    // Use default values
    const basePremiumBps = 200;
    const durationMultiplierBps = 50;
    const months = Math.ceil(durationSeconds / (30 * 24 * 60 * 60));
    const basePremium = (BigInt(coverageAmount) * BigInt(basePremiumBps)) / BigInt(10000);
    const durationPremium = (BigInt(coverageAmount) * BigInt(durationMultiplierBps) * BigInt(months)) / BigInt(10000);
    let premium = basePremium + durationPremium;
    if (premium < BigInt(1e18)) {
      premium = BigInt(1e18); // Minimum 1 ETH
    }
    return premium.toString();
  }

  const basePremium = (BigInt(coverageAmount) * BigInt(config.base_premium_bps)) / BigInt(10000);
  const months = Math.ceil(durationSeconds / (30 * 24 * 60 * 60));
  const durationPremium = (BigInt(coverageAmount) * BigInt(config.duration_multiplier_bps) * BigInt(months)) / BigInt(10000);
  let premium = basePremium + durationPremium;
  
  const minPremium = BigInt(config.min_coverage);
  if (premium < minPremium) {
    premium = minPremium;
  }

  return premium.toString();
};

/**
 * Get insurance stats
 */
const getInsuranceStats = async () => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_policies,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_policies,
        COUNT(CASE WHEN status = 'claimed' THEN 1 END) as claimed_policies,
        SUM(COVERAGE_AMOUNT::numeric) as total_coverage,
        SUM(premium_paid::numeric) as total_premiums
      FROM insurance_policies
    `);

    return result.rows[0];
  } catch (error) {
    console.error("[InsuranceService] Error getting stats:", error.message);
    throw error;
  }
};

module.exports = {
  getInsuranceContract,
  getInsuranceContractWithSigner,
  statusToString,
  reasonToString,
  stringToReason,
  getPremiumConfig,
  calculatePremiumOnChain,
  purchaseInsuranceOnChain,
  fileClaimOnChain,
  approveClaimOnChain,
  getPolicyFromChain,
  hasPolicyOnChain,
  createPolicy,
  getPolicy,
  getPoliciesByInvoice,
  getPoliciesByAddress,
  getActivePolicies,
  updatePolicyStatus,
  createClaim,
  getClaim,
  getClaimsByPolicy,
  updateClaimStatus,
  getInsuranceConfig,
  calculatePremiumLocally,
  getInsuranceStats
};
