const { getSigner, contractAddresses } = require('../config/blockchain');
const ComplianceManagerArtifact = require('../../deployed/ComplianceManager.json');
const { ethers } = require('ethers');
const { pool } = require('../config/database');

/**
 * Start listening to ComplianceManager contract events
 * Subscribes to KYCVerified, KYCRevoked, and AccountFrozen events
 */
function startComplianceListeners() {
  const signer = getSigner();
  const provider = signer.provider || new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
  const complianceManager = new ethers.Contract(
    contractAddresses.complianceManager,
    ComplianceManagerArtifact.abi,
    provider
  );

  // Listen for KYCVerified event
  complianceManager.on('KYCVerified', async (account) => {
    try {
      console.log('[complianceListener] KYCVerified event:', account);
      
      // Update wallet_kyc_mappings table
      await pool.query(
        `UPDATE wallet_kyc_mappings 
         SET kyc_status = 'verified', on_chain_verified = true, verified_at = CURRENT_TIMESTAMP, last_synced_at = CURRENT_TIMESTAMP 
         WHERE LOWER(wallet_address) = $1`,
        [account.toLowerCase()]
      );
      
      // Update users table for backward compatibility
      await pool.query(
        'UPDATE users SET kyc_status = $1 WHERE LOWER(wallet_address) = $2',
        ['verified', account.toLowerCase()]
      );
      
      console.log('[complianceListener] Updated wallet status to verified:', account);
    } catch (err) {
      console.error('[complianceListener] Error handling KYCVerified event:', err.message || err);
    }
  });

  // Listen for KYCRevoked event
  complianceManager.on('KYCRevoked', async (account) => {
    try {
      console.log('[complianceListener] KYCRevoked event:', account);
      
      // Update wallet_kyc_mappings table
      await pool.query(
        `UPDATE wallet_kyc_mappings 
         SET kyc_status = 'revoked', on_chain_verified = false, last_synced_at = CURRENT_TIMESTAMP 
         WHERE LOWER(wallet_address) = $1`,
        [account.toLowerCase()]
      );
      
      // Update users table for backward compatibility
      await pool.query(
        'UPDATE users SET kyc_status = $1 WHERE LOWER(wallet_address) = $2',
        ['revoked', account.toLowerCase()]
      );
      
      console.log('[complianceListener] Updated wallet status to revoked:', account);
    } catch (err) {
      console.error('[complianceListener] Error handling KYCRevoked event:', err.message || err);
    }
  });

  // Listen for AccountFrozen event
  complianceManager.on('AccountFrozen', async (account, reason) => {
    try {
      console.log('[complianceListener] AccountFrozen event:', account, 'Reason:', reason);
      
      // Freeze user account
      await pool.query(
        'UPDATE users SET is_frozen = true WHERE LOWER(wallet_address) = $1',
        [account.toLowerCase()]
      );
      
      console.log('[complianceListener] Froze account:', account);
    } catch (err) {
      console.error('[complianceListener] Error handling AccountFrozen event:', err.message || err);
    }
  });

  console.log('[complianceListener] Compliance event listeners started successfully');
}

module.exports = startComplianceListeners;