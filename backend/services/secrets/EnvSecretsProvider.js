const SecretsProvider = require('./SecretsProvider');

/**
 * Environment Variables Secrets Provider
 * Uses process.env for secret storage. Suitable for development only.
 * WARNING: Not recommended for production - use AWS Secrets Manager or HashiCorp Vault instead.
 */
class EnvSecretsProvider extends SecretsProvider {
  constructor() {
    super();
    this.cache = new Map();
  }

  /**
   * Retrieves a secret from environment variables.
   * @param {string} key - The environment variable name
   * @returns {Promise<string|null>} The secret value or null if not found
   */
  async getSecret(key) {
    const value = process.env[key] || null;
    
    // Cache for faster subsequent access
    if (value) {
      this.cache.set(key, value);
    }
    
    return value;
  }

  /**
   * Sets an environment variable (runtime only, not persisted).
   * Note: This only sets the value for the current process.
   * @param {string} key - The environment variable name
   * @param {string} value - The value to set
   * @returns {Promise<void>}
   */
  async setSecret(key, value) {
    process.env[key] = value;
    this.cache.set(key, value);
  }

  /**
   * Deletes an environment variable (runtime only).
   * @param {string} key - The environment variable name
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteSecret(key) {
    const exists = process.env[key] !== undefined;
    delete process.env[key];
    this.cache.delete(key);
    return exists;
  }

  /**
   * Checks if an environment variable exists.
   * @param {string} key - The environment variable name
   * @returns {Promise<boolean>} True if exists
   */
  async hasSecret(key) {
    return process.env[key] !== undefined;
  }

  /**
   * Health check - always returns true for env provider.
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    return true;
  }

  /**
   * Clears the internal cache.
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = EnvSecretsProvider;
