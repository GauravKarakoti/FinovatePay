/**
 * Abstract base class for secrets management providers.
 * Implementations should provide secure storage and retrieval of sensitive data.
 */
class SecretsProvider {
  constructor() {
    if (this.constructor === SecretsProvider) {
      throw new Error('SecretsProvider is an abstract class and cannot be instantiated directly');
    }
  }

  /**
   * Retrieves a secret value by its key.
   * @param {string} key - The secret key identifier
   * @returns {Promise<string|null>} The secret value or null if not found
   */
  async getSecret(key) {
    throw new Error('Method getSecret() must be implemented');
  }

  /**
   * Stores a secret value with the given key.
   * @param {string} key - The secret key identifier
   * @param {string} value - The secret value to store
   * @returns {Promise<void>}
   */
  async setSecret(key, value) {
    throw new Error('Method setSecret() must be implemented');
  }

  /**
   * Deletes a secret by its key.
   * @param {string} key - The secret key identifier
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteSecret(key) {
    throw new Error('Method deleteSecret() must be implemented');
  }

  /**
   * Checks if a secret exists.
   * @param {string} key - The secret key identifier
   * @returns {Promise<boolean>} True if the secret exists
   */
  async hasSecret(key) {
    throw new Error('Method hasSecret() must be implemented');
  }

  /**
   * Health check for the secrets provider.
   * @returns {Promise<boolean>} True if the provider is healthy
   */
  async healthCheck() {
    throw new Error('Method healthCheck() must be implemented');
  }
}

module.exports = SecretsProvider;
