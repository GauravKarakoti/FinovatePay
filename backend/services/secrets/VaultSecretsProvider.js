const SecretsProvider = require('./SecretsProvider');

/**
 * HashiCorp Vault Secrets Provider
 * Securely stores and retrieves secrets from HashiCorp Vault.
 * Requires vault npm package and appropriate Vault permissions.
 */
class VaultSecretsProvider extends SecretsProvider {
  constructor(options = {}) {
    super();
    
    this.vaultAddr = options.vaultAddr || process.env.VAULT_ADDR || 'http://localhost:8200';
    this.vaultToken = options.vaultToken || process.env.VAULT_TOKEN;
    this.secretPath = options.secretPath || process.env.VAULT_SECRET_PATH || 'secret/data/finovatepay';
    this.mountPath = options.mountPath || process.env.VAULT_MOUNT_PATH || 'secret';
    
    if (!this.vaultToken) {
      throw new Error('VAULT_TOKEN environment variable is required for VaultSecretsProvider');
    }

    this._vaultClient = null;
    this._cachedSecrets = null;
    this._cacheExpiry = null;
    this._cacheTTL = options.cacheTTL || 300000; // 5 minutes default
  }

  /**
   * Gets the Vault client (lazy initialization).
   * @returns {Object} Vault client
   */
  _getClient() {
    if (!this._vaultClient) {
      try {
        const Vault = require('node-vault');
        this._vaultClient = Vault({
          endpoint: this.vaultAddr,
          token: this.vaultToken
        });
      } catch (error) {
        throw new Error('node-vault package is required for HashiCorp Vault. Install with: npm install node-vault');
      }
    }
    return this._vaultClient;
  }

  /**
   * Fetches secrets from Vault and caches them.
   * @returns {Promise<Object>} Object containing all secrets
   */
  async _fetchSecrets() {
    // Return cached secrets if still valid
    if (this._cachedSecrets && this._cacheExpiry && Date.now() < this._cacheExpiry) {
      return this._cachedSecrets;
    }

    const vault = this._getClient();
    
    try {
      // KV v2 engine path format
      const response = await vault.read(this.secretPath);
      
      // KV v2 stores data under data.data
      const secrets = response.data?.data || response.data || {};
      
      this._cachedSecrets = secrets;
      this._cacheExpiry = Date.now() + this._cacheTTL;
      
      return secrets;
    } catch (error) {
      if (error.response?.statusCode === 404) {
        // Secret doesn't exist yet
        this._cachedSecrets = {};
        this._cacheExpiry = Date.now() + this._cacheTTL;
        return {};
      }
      throw error;
    }
  }

  /**
   * Retrieves a secret by key from Vault.
   * @param {string} key - The secret key
   * @returns {Promise<string|null>} The secret value or null
   */
  async getSecret(key) {
    const secrets = await this._fetchSecrets();
    return secrets[key] || null;
  }

  /**
   * Stores a secret in Vault.
   * @param {string} key - The secret key
   * @param {string} value - The secret value
   * @returns {Promise<void>}
   */
  async setSecret(key, value) {
    const vault = this._getClient();
    
    // Get existing secrets
    let secrets = {};
    try {
      secrets = await this._fetchSecrets();
    } catch (error) {
      // Ignore if secret doesn't exist yet
    }

    // Update the secret
    secrets[key] = value;
    
    // KV v2 write format
    const path = this.secretPath.replace('/data/', '/data/');
    
    try {
      await vault.write(path, { data: secrets });
    } catch (error) {
      // Try alternative path format for KV v1
      try {
        await vault.write(this.secretPath, secrets);
      } catch (v1Error) {
        throw error;
      }
    }

    // Update cache
    this._cachedSecrets = secrets;
    this._cacheExpiry = Date.now() + this._cacheTTL;
  }

  /**
   * Deletes a secret from Vault.
   * @param {string} key - The secret key to delete
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteSecret(key) {
    const secrets = await this._fetchSecrets();
    
    if (!(key in secrets)) {
      return false;
    }

    delete secrets[key];
    
    const vault = this._getClient();
    const path = this.secretPath.replace('/data/', '/data/');
    
    try {
      await vault.write(path, { data: secrets });
    } catch (error) {
      // Try KV v1 format
      await vault.write(this.secretPath, secrets);
    }

    // Update cache
    this._cachedSecrets = secrets;
    this._cacheExpiry = Date.now() + this._cacheTTL;
    
    return true;
  }

  /**
   * Checks if a secret exists.
   * @param {string} key - The secret key
   * @returns {Promise<boolean>} True if exists
   */
  async hasSecret(key) {
    const secrets = await this._fetchSecrets();
    return key in secrets;
  }

  /**
   * Health check for Vault connectivity.
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    const vault = this._getClient();
    
    try {
      const health = await vault.health();
      return health.initialized && !health.sealed;
    } catch (error) {
      console.error('Vault health check failed:', error.message);
      return false;
    }
  }

  /**
   * Clears the internal cache.
   */
  clearCache() {
    this._cachedSecrets = null;
    this._cacheExpiry = null;
  }
}

module.exports = VaultSecretsProvider;
