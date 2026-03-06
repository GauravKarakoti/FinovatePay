const { pool } = require('../config/database');
const crypto = require('crypto');

/**
 * API Key Scopes
 */
const ApiKeyScopes = {
  READ: 'read',
  WRITE: 'write',
  ADMIN: 'admin',
  INVOICE_READ: 'invoice:read',
  INVOICE_WRITE: 'invoice:write',
  PAYMENT_READ: 'payment:read',
  PAYMENT_WRITE: 'payment:write',
  USER_READ: 'user:read',
  USER_WRITE: 'user:write'
};

/**
 * ApiKey Model
 * Manages API keys for third-party integrations with scope-based access control.
 */
class ApiKey {
  /**
   * Generates a new API key.
   * Format: {prefix}_{random_string}
   * @param {string} prefix - Key prefix (e.g., 'fp_live', 'fp_test')
   * @returns {Object} Object containing the plain text key and hash
   */
  static generateKey(prefix = 'fp_live') {
    const randomString = crypto.randomBytes(32).toString('base64url');
    const key = `${prefix}_${randomString}`;
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    const keyPrefix = key.substring(0, 8); // e.g., 'fp_live_'
    
    return { key, keyHash, keyPrefix };
  }

  /**
   * Creates a new API key for a user.
   * @param {Object} data - API key data
   * @param {number} data.userId - User ID
   * @param {string} data.name - Key name/description
   * @param {string[]} [data.scopes] - Array of scopes
   * @param {Date} [data.expiresAt] - Expiration date
   * @param {string} [data.description] - Key description
   * @param {string} [data.prefix='fp_live'] - Key prefix
   * @returns {Promise<Object>} Created key record with plain text key
   */
  static async create({ userId, name, scopes = ['read'], expiresAt, description, prefix = 'fp_live' }) {
    const { key, keyHash, keyPrefix } = this.generateKey(prefix);
    
    const query = `
      INSERT INTO api_keys (
        user_id, key_hash, key_prefix, name, description, scopes, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, key_prefix, name, description, scopes, expires_at, created_at
    `;
    
    const values = [userId, keyHash, keyPrefix, name, description, scopes, expiresAt];
    const result = await pool.query(query, values);
    
    // Return the created key with the plain text key (only time it's shown)
    return {
      ...result.rows[0],
      key // Plain text key - must be shown to user once
    };
  }

  /**
   * Finds a valid (non-revoked, non-expired) API key by its hash.
   * @param {string} key - Plain text API key
   * @returns {Promise<Object|null>} API key record or null
   */
  static async findValidKey(key) {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const query = `
      SELECT id, user_id, key_prefix, name, scopes, expires_at, created_at
      FROM api_keys
      WHERE key_hash = $1
        AND revoked = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    
    const result = await pool.query(query, [keyHash]);
    return result.rows[0] || null;
  }

  /**
   * Finds all API keys for a user (without sensitive data).
   * @param {number} userId - User ID
   * @returns {Promise<Array>} Array of API key records
   */
  static async findByUserId(userId) {
    const query = `
      SELECT id, key_prefix, name, description, scopes, last_used_at, 
             last_used_ip, expires_at, revoked, revoked_at, created_at
      FROM api_keys
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  /**
   * Finds an API key by ID.
   * @param {number} id - API key ID
   * @param {number} userId - User ID (for authorization)
   * @returns {Promise<Object|null>} API key record or null
   */
  static async findById(id, userId) {
    const query = `
      SELECT id, user_id, key_prefix, name, description, scopes, 
             last_used_at, last_used_ip, expires_at, revoked, created_at
      FROM api_keys
      WHERE id = $1 AND user_id = $2
    `;
    
    const result = await pool.query(query, [id, userId]);
    return result.rows[0] || null;
  }

  /**
   * Updates the last used timestamp and IP for an API key.
   * @param {string} key - Plain text API key
   * @param {string} ipAddress - Client IP address
   * @returns {Promise<boolean>} True if updated
   */
  static async updateLastUsed(key, ipAddress) {
    const keyHash = crypto.createHash('sha256').update(key).digest('hex');
    
    const query = `
      UPDATE api_keys
      SET last_used_at = NOW(), last_used_ip = $2
      WHERE key_hash = $1 AND revoked = FALSE
    `;
    
    const result = await pool.query(query, [keyHash, ipAddress]);
    return result.rowCount > 0;
  }

  /**
   * Revokes an API key.
   * @param {number} id - API key ID
   * @param {number} userId - User ID (for authorization)
   * @param {string} [reason='user_revoked'] - Reason for revocation
   * @returns {Promise<boolean>} True if revoked
   */
  static async revoke(id, userId, reason = 'user_revoked') {
    const query = `
      UPDATE api_keys
      SET revoked = TRUE, revoked_at = NOW(), revoked_reason = $3
      WHERE id = $1 AND user_id = $2 AND revoked = FALSE
    `;
    
    const result = await pool.query(query, [id, userId, reason]);
    return result.rowCount > 0;
  }

  /**
   * Updates an API key's name, description, or scopes.
   * @param {number} id - API key ID
   * @param {number} userId - User ID (for authorization)
   * @param {Object} data - Data to update
   * @returns {Promise<Object|null>} Updated API key record
   */
  static async update(id, userId, data) {
    const { name, description, scopes } = data;
    
    const query = `
      UPDATE api_keys
      SET name = COALESCE($3, name),
          description = COALESCE($4, description),
          scopes = COALESCE($5, scopes)
      WHERE id = $1 AND user_id = $2 AND revoked = FALSE
      RETURNING id, key_prefix, name, description, scopes, expires_at, created_at
    `;
    
    const result = await pool.query(query, [id, userId, name, description, scopes]);
    return result.rows[0] || null;
  }

  /**
   * Deletes an API key.
   * @param {number} id - API key ID
   * @param {number} userId - User ID (for authorization)
   * @returns {Promise<boolean>} True if deleted
   */
  static async delete(id, userId) {
    const query = `DELETE FROM api_keys WHERE id = $1 AND user_id = $2`;
    const result = await pool.query(query, [id, userId]);
    return result.rowCount > 0;
  }

  /**
   * Checks if a key has a specific scope.
   * @param {Object} apiKey - API key record
   * @param {string} scope - Scope to check
   * @returns {boolean} True if key has the scope
   */
  static hasScope(apiKey, scope) {
    if (!apiKey || !apiKey.scopes) return false;
    
    // Admin scope grants all permissions
    if (apiKey.scopes.includes(ApiKeyScopes.ADMIN)) return true;
    
    // Check for exact scope match
    if (apiKey.scopes.includes(scope)) return true;
    
    // Check for wildcard scope (e.g., 'read' covers 'invoice:read')
    const [resource] = scope.split(':');
    if (apiKey.scopes.includes(resource)) return true;
    
    return false;
  }

  /**
   * Validates API key format.
   * @param {string} key - API key to validate
   * @returns {boolean} True if valid format
   */
  static isValidFormat(key) {
    if (!key || typeof key !== 'string') return false;
    // Format: {prefix}_{random_string}
    const pattern = /^[a-z]+_[a-zA-Z0-9_-]+$/;
    return pattern.test(key) && key.length >= 20;
  }

  /**
   * Cleans up expired API keys from the database.
   * @returns {Promise<number>} Number of keys deleted
   */
  static async cleanupExpired() {
    const query = `
      DELETE FROM api_keys
      WHERE expires_at < NOW()
      RETURNING id
    `;
    
    const result = await pool.query(query);
    return result.rowCount;
  }

  /**
   * Gets API key statistics for a user.
   * @param {number} userId - User ID
   * @returns {Promise<Object>} API key statistics
   */
  static async getStats(userId) {
    const query = `
      SELECT 
        COUNT(*) FILTER (WHERE revoked = FALSE AND (expires_at IS NULL OR expires_at > NOW())) as active_count,
        COUNT(*) FILTER (WHERE revoked = TRUE) as revoked_count,
        COUNT(*) FILTER (WHERE expires_at IS NOT NULL AND expires_at <= NOW()) as expired_count,
        MAX(last_used_at) as last_used
      FROM api_keys
      WHERE user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    return result.rows[0];
  }
}

module.exports = { ApiKey, ApiKeyScopes };
