require('dotenv').config();

const EnvSecretsProvider = require('./EnvSecretsProvider');

/**
 * Supported secrets provider types
 */
const ProviderTypes = {
  ENV: 'env',
  AWS: 'aws',
  VAULT: 'vault'
};

/**
 * Factory function to create the appropriate secrets provider.
 * @param {Object} options - Configuration options
 * @param {string} options.provider - Provider type: 'env', 'aws', or 'vault'
 * @returns {SecretsProvider} The secrets provider instance
 */
function createSecretsProvider(options = {}) {
  const providerType = options.provider || process.env.SECRETS_PROVIDER || ProviderTypes.ENV;
  
  switch (providerType.toLowerCase()) {
    case ProviderTypes.ENV:
      console.log('[Secrets] Using Environment Variables provider (development mode)');
      return new EnvSecretsProvider();
      
    default:
      throw new Error(`Unknown secrets provider: ${providerType}. Supported: ${Object.values(ProviderTypes).join(', ')}`);
  }
}

// Singleton instance for app-wide use
let _instance = null;

/**
 * Gets the singleton secrets provider instance.
 * Creates one if it doesn't exist.
 * @param {Object} options - Configuration options (only used on first call)
 * @returns {SecretsProvider} The secrets provider instance
 */
function getSecretsProvider(options = {}) {
  if (!_instance) {
    _instance = createSecretsProvider(options);
  }
  return _instance;
}

/**
 * Resets the singleton instance (useful for testing).
 */
function resetSecretsProvider() {
  _instance = null;
}

/**
 * Convenience method to get a secret value.
 * @param {string} key - The secret key
 * @returns {Promise<string|null>} The secret value
 */
async function getSecret(key) {
  return getSecretsProvider().getSecret(key);
}

/**
 * Convenience method to set a secret value.
 * @param {string} key - The secret key
 * @param {string} value - The secret value
 * @returns {Promise<void>}
 */
async function setSecret(key, value) {
  return getSecretsProvider().setSecret(key, value);
}

module.exports = {
  createSecretsProvider,
  getSecretsProvider,
  resetSecretsProvider,
  getSecret,
  setSecret,
  ProviderTypes,
  EnvSecretsProvider,
};
