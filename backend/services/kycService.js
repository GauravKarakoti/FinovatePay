const { pool } = require('../config/database');
const { getSigner, contractAddresses } = require('../config/blockchain');
const ComplianceManagerArtifact = require('../../deployed/ComplianceManager.json');
const { ethers } = require('ethers');

/**
 * Get wallet KYC status from database
 * Falls back to users table if wallet not in wallet_kyc_mappings
 */
async function getWalletStatus(walletAddress) {
  const wallet = walletAddress.toLowerCase();
  
  // Try wallet_kyc_mappings first (primary source of truth for wallet-level KYC)
  const result = await pool.query(
    'SELECT * FROM wallet_kyc_mappings WHERE LOWER(wallet_address) = $1',
    [wallet]
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Fallback to users table for legacy data
  const userResult = await pool.query(
    'SELECT kyc_status, kyc_risk_level FROM users WHERE LOWER(wallet_address) = $1',
    [wallet]
  );

  if (userResult.rows.length > 0) {
    return {
      wallet_address: wallet,
      kyc_status: userResult.rows[0].kyc_status || 'unknown',
      risk_level: userResult.rows[0].kyc_risk_level || 'unknown',
      on_chain_verified: false
    };
  }

  return {
    wallet_address: wallet,
    kyc_status: 'unknown',
    risk_level: 'unknown',
    on_chain_verified: false
  };
}

/**
 * Insert or update wallet KYC mapping in database
 * Uses PostgreSQL upsert (INSERT ... ON CONFLICT)
 */
async function upsertWalletMapping({
  walletAddress,
  status,
  riskLevel,
  provider,
  verificationHash,
  onChainVerified,
  verifiedAt
}) {
  const wallet = walletAddress.toLowerCase();
  
  await pool.query(
    `INSERT INTO wallet_kyc_mappings 
     (wallet_address, kyc_status, risk_level, provider, verification_hash, on_chain_verified, verified_at, last_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
     ON CONFLICT (wallet_address) DO UPDATE SET
       kyc_status = EXCLUDED.kyc_status,
       risk_level = EXCLUDED.risk_level,
       provider = EXCLUDED.provider,
       verification_hash = EXCLUDED.verification_hash,
       on_chain_verified = EXCLUDED.on_chain_verified,
       verified_at = EXCLUDED.verified_at,
       last_synced_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
    `,
    [wallet, status, riskLevel, provider, verificationHash, onChainVerified || false, verifiedAt || null]
  );
}

/**
 * Sync wallet KYC status with on-chain ComplianceManager contract
 * Calls isKYCVerified to get current on-chain status and updates DB
 */
async function syncWithBlockchain(walletAddress) {
  const signer = getSigner();
  const provider = signer.provider || new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  const complianceManager = new ethers.Contract(
    contractAddresses.complianceManager,
    ComplianceManagerArtifact.abi,
    provider
  );

  try {
    // Query the smart contract for current verification status
    const verified = await complianceManager.isKYCVerified(walletAddress);
    
    // Update local database with on-chain status
    await pool.query(
      'UPDATE wallet_kyc_mappings SET on_chain_verified = $1, last_synced_at = CURRENT_TIMESTAMP WHERE LOWER(wallet_address) = $2',
      [verified, walletAddress.toLowerCase()]
    );
    
    return verified;
  } catch (err) {
    console.error('syncWithBlockchain error:', err.message || err);
    throw err;
  }
}

module.exports = {
  getWalletStatus,
  upsertWalletMapping,
  syncWithBlockchain
};