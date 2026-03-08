const { pool } = require('../config/database');
const crypto = require('crypto');

/**
 * RefreshToken Model
 * Manages JWT refresh tokens with support for rotation, revocation, and security tracking.
 */
class RefreshToken {
  /**
   * Creates a new refresh token for a user.
   * @param {Object} data - Token data
   * @param {number} data.userId - User ID
   * @param {string} data.token - Plain text token (will be hashed)
   * @param {Date} data.expiresAt - Expiration date
   * @param {string} [data.deviceInfo] - Device information
   * @param {string} [data.ipAddress] - Client IP address
   * @param {string} [data.userAgent] - User agent string
   * @returns {Promise<Object>} Created token record
   */
  static async create({ userId, token, expiresAt, deviceInfo, ipAddress, userAgent }) {
    // Hash the token for storage (SHA-256)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const query = `
      INSERT INTO refresh_tokens (
        user_id, token_hash, device_info, ip_address, user_agent, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, device_info, ip_address, expires_at, created_at
    `;
    
    const values = [userId, tokenHash, deviceInfo, ipAddress, userAgent, expiresAt];
    const result = await pool.query(query, values);
    
    return result.rows[0];
  }

  /**
   * Finds a valid (non-revoked, non-expired) token by its hash.
   * @param {string} token - Plain text token
   * @returns {Promise<Object|null>} Token record or null
   */
  static async findValidToken(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const query = `
      SELECT id, user_id, token_hash, device_info, ip_address, expires_at, created_at, last_used_at
      FROM refresh_tokens
      WHERE token_hash = $1
        AND revoked = FALSE
        AND expires_at > NOW()
    `;
    
    const result = await pool.query(query, [tokenHash]);
    return result.rows[0] || null;
  }

  /**
   * Finds all active tokens for a user.
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of token records
   */
  static async findByUserId(userId) {
    const query = `
      SELECT id, device_info, ip_address, expires_at, created_at, last_used_at
      FROM refresh_tokens
      WHERE user_id = $1
        AND revoked = FALSE
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Updates the last used timestamp for a token.
   * @param {string} token - Plain text token
   * @returns {Promise<boolean>} True if updated
   */
  static async updateLastUsed(token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const query = `
      UPDATE refresh_tokens
      SET last_used_at = NOW()
      WHERE token_hash = $1 AND revoked = FALSE
    `;
    
    const result = await pool.query(query, [tokenHash]);
    return result.rowCount > 0;
  }

  /**
   * Revokes a specific token.
   * @param {string} token - Plain text token
   * @param {string} [reason] - Reason for revocation
   * @returns {Promise<boolean>} True if revoked
   */
  static async revoke(token, reason = 'user_logout') {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const query = `
      UPDATE refresh_tokens
      SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
      WHERE token_hash = $1 AND revoked = FALSE
    `;
    
    const result = await pool.query(query, [tokenHash, reason]);
    return result.rowCount > 0;
  }

  /**
   * Revokes all tokens for a user (useful for "logout all devices").
   * @param {number} userId - User ID
   * @param {string} [reason] - Reason for revocation
   * @param {string} [exceptToken] - Token to exclude from revocation
   * @returns {Promise<number>} Number of tokens revoked
   */
  static async revokeAllForUser(userId, reason = 'logout_all', exceptToken = null) {
    let query = `
      UPDATE refresh_tokens
      SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $2
      WHERE user_id = $1 AND revoked = FALSE
    `;
    
    const values = [userId, reason];
    
    if (exceptToken) {
      const exceptHash = crypto.createHash('sha256').update(exceptToken).digest('hex');
      query += ' AND token_hash != $3';
      values.push(exceptHash);
    }
    
    const result = await pool.query(query, values);
    return result.rowCount;
  }

  /**
   * Cleans up expired tokens from the database.
   * @returns {Promise<number>} Number of tokens deleted
   */
  static async cleanupExpired() {
    const query = `
      DELETE FROM refresh_tokens
      WHERE expires_at < NOW()
      RETURNING id
    `;
    
    const result = await pool.query(query);
    return result.rowCount;
  }

  /**
   * Checks if a token has been compromised (used from different IP/device).
   * @param {string} token - Plain text token
   * @param {string} currentIp - Current IP address
   * @returns {Promise<boolean>} True if potentially compromised
   */
  static async checkCompromised(token, currentIp) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    const query = `
      SELECT ip_address
      FROM refresh_tokens
      WHERE token_hash = $1
    `;
    
    const result = await pool.query(query, [tokenHash]);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    const storedIp = result.rows[0].ip_address;
    
    // If token was created from a different IP and now being used from a new one
    // This is a simple check - more sophisticated detection could be added
    return storedIp && storedIp !== currentIp;
  }

  /**
   * Generates a cryptographically secure refresh token.
   * @returns {string} Random token string
   */
  static generateToken() {
    return crypto.randomBytes(64).toString('base64url');
  }

  /**
   * Gets token statistics for a user.
   * @param {number} userId - User ID
   * @returns {Promise<Object>} Token statistics
   */
  static async getStats(userId) {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE revoked = FALSE AND expires_at > NOW()) as active_count,
        COUNT(*) FILTER (WHERE revoked = TRUE) as revoked_count,
        COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired_count,
        MAX(created_at) FILTER (WHERE revoked = FALSE) as last_created
      FROM refresh_tokens
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }
}

module.exports = RefreshToken;
