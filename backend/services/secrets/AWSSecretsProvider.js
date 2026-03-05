const SecretsProvider = require('./SecretsProvider');

/**
 * AWS Secrets Manager Provider
 * Securely stores and retrieves secrets from AWS Secrets Manager.
 * Requires AWS SDK and appropriate IAM permissions.
 */
class AWSSecretsProvider extends SecretsProvider {
  constructor(options = {}) {
    super();
    
    this.region = options.region || process.env.AWS_REGION || 'us-east-1';
    this.secretName = options.secretName || process.env.AWS_SECRET_NAME;
    
    if (!this.secretName) {
      throw new Error('AWS_SECRET_NAME environment variable is required for AWSSecretsProvider');
    }

    // Lazy-load AWS SDK to avoid dependency issues if not using AWS
    this._secretsManagerClient = null;
    this._cachedSecrets = null;
    this._cacheExpiry = null;
    this._cacheTTL = options.cacheTTL || 300000; // 5 minutes default
  }

  /**
   * Gets the AWS Secrets Manager client (lazy initialization).
   * @returns {Object} AWS Secrets Manager client
   */
  _getClient() {
    if (!this._secretsManagerClient) {
      try {
        const { SecretsManagerClient, GetSecretValueCommand, CreateSecretCommand, DeleteSecretCommand } = require('@aws-sdk/client-secrets-manager');
        this._secretsManagerClient = {
          client: new SecretsManagerClient({ region: this.region }),
          GetSecretValueCommand,
          CreateSecretCommand,
          DeleteSecretCommand
        };
      } catch (error) {
        throw new Error('@aws-sdk/client-secrets-manager package is required for AWS Secrets Manager. Install with: npm install @aws-sdk/client-secrets-manager');
      }
    }
    return this._secretsManagerClient;
  }

  /**
   * Fetches all secrets from AWS Secrets Manager and caches them.
   * @returns {Promise<Object>} Object containing all secrets
   */
  async _fetchSecrets() {
    // Return cached secrets if still valid
    if (this._cachedSecrets && this._cacheExpiry && Date.now() < this._cacheExpiry) {
      return this._cachedSecrets;
    }

    const { client, GetSecretValueCommand } = this._getClient();
    
    try {
      const command = new GetSecretValueCommand({ SecretId: this.secretName });
      const response = await client.send(command);
      
      let secrets;
      if (response.SecretString) {
        secrets = JSON.parse(response.SecretString);
      } else if (response.SecretBinary) {
        const buff = Buffer.from(response.SecretBinary, 'base64');
        secrets = JSON.parse(buff.toString('ascii'));
      } else {
        secrets = {};
      }

      this._cachedSecrets = secrets;
      this._cacheExpiry = Date.now() + this._cacheTTL;
      
      return secrets;
    } catch (error) {
      if (error.name === 'ResourceNotFoundException') {
        // Secret doesn't exist yet, return empty object
        this._cachedSecrets = {};
        this._cacheExpiry = Date.now() + this._cacheTTL;
        return {};
      }
      throw error;
    }
  }

  /**
   * Retrieves a secret by key from AWS Secrets Manager.
   * @param {string} key - The secret key
   * @returns {Promise<string|null>} The secret value or null
   */
  async getSecret(key) {
    const secrets = await this._fetchSecrets();
    return secrets[key] || null;
  }

  /**
   * Stores a secret in AWS Secrets Manager.
   * Note: This updates the entire secret object.
   * @param {string} key - The secret key
   * @param {string} value - The secret value
   * @returns {Promise<void>}
   */
  async setSecret(key, value) {
    const { client, CreateSecretCommand } = this._getClient();
    
    // Get existing secrets
    let secrets = {};
    try {
      secrets = await this._fetchSecrets();
    } catch (error) {
      // Ignore if secret doesn't exist yet
    }

    // Update the secret
    secrets[key] = value;
    
    const command = new CreateSecretCommand({
      Name: this.secretName,
      SecretString: JSON.stringify(secrets)
    });

    try {
      await client.send(command);
    } catch (error) {
      // If secret already exists, try updating it
      if (error.name === 'ResourceExistsException') {
        const { PutSecretValueCommand } = this._getClient();
        const updateCommand = new PutSecretValueCommand({
          SecretId: this.secretName,
          SecretString: JSON.stringify(secrets)
        });
        await client.send(updateCommand);
      } else {
        throw error;
      }
    }

    // Update cache
    this._cachedSecrets = secrets;
    this._cacheExpiry = Date.now() + this._cacheTTL;
  }

  /**
   * Deletes a secret from AWS Secrets Manager.
   * @param {string} key - The secret key to delete
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteSecret(key) {
    const secrets = await this._fetchSecrets();
    
    if (!(key in secrets)) {
      return false;
    }

    delete secrets[key];
    
    const { client, CreateSecretCommand } = this._getClient();
    const { PutSecretValueCommand } = this._getClient();
    
    const command = new PutSecretValueCommand({
      SecretId: this.secretName,
      SecretString: JSON.stringify(secrets)
    });

    await client.send(command);
    
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
   * Health check for AWS Secrets Manager connectivity.
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      await this._fetchSecrets();
      return true;
    } catch (error) {
      console.error('AWS Secrets Manager health check failed:', error.message);
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

module.exports = AWSSecretsProvider;
