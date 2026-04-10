const { contractAddresses, getProvider } = require('../config/blockchain');
const ComplianceManagerArtifact = require('../../deployed/ComplianceManager.json');
const { ethers } = require('ethers');
const { pool } = require('../config/database');
const logger = require('../utils/logger')('complianceListener');

/**
 * Start listening to ComplianceManager contract events
 * Subscribes to KYCVerified, KYCRevoked, and AccountFrozen events
 */
function startComplianceListeners() {
  try {
    // 🟢 FIX: Directly use the centralized WebSocket provider
    const provider = getProvider(); 
    
    const complianceManager = new ethers.Contract(
      contractAddresses.complianceManager,
      ComplianceManagerArtifact.abi,
      provider
    );

    // Listen for KYCVerified event
    complianceManager.on('KYCVerified', async (account) => {
      try {
        logger.info('[complianceListener] KYCVerified event:', account);
        
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
        
        logger.info('[complianceListener] Updated wallet status to verified:', account);
      } catch (err) {
        console.error('[complianceListener] Error handling KYCVerified event:', err.message || err);
      }
    });

    // Listen for KYCRevoked event
    complianceManager.on('KYCRevoked', async (account) => {
      try {
        logger.info('[complianceListener] KYCRevoked event:', account);
        
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
        
        logger.info('[complianceListener] Updated wallet status to revoked:', account);
      } catch (err) {
        console.error('[complianceListener] Error handling KYCRevoked event:', err.message || err);
      }
    });

    // Listen for AccountFrozen event
    complianceManager.on('AccountFrozen', async (account, reason) => {
      try {
        logger.info('[complianceListener] AccountFrozen event:', account, 'Reason:', reason);
        
        // Freeze user account
        await pool.query(
          'UPDATE users SET is_frozen = true WHERE LOWER(wallet_address) = $1',
          [account.toLowerCase()]
        );
        
        logger.info('[complianceListener] Froze account:', account);
      } catch (err) {
        console.error('[complianceListener] Error handling AccountFrozen event:', err.message || err);
      }
    });

    logger.info('[complianceListener] Compliance event listeners started successfully');
  } catch (error) {
    logger.error('[complianceListener] Failed to start listeners:', error.message);
  }
}

module.exports = startComplianceListeners;