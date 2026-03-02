/**
 * Environment Variable Validator
 * Validates required environment variables at application startup
 * Prevents application from starting with missing or invalid critical configuration
 */

const chalk = require('chalk');

// Environment variable categories and validation rules
const ENV_CONFIG = {
  // CRITICAL: Application cannot start without these
  CRITICAL: {
    JWT_SECRET: {
      required: true,
      validate: (val) => val && val.length >= 32,
      errorMsg: 'JWT_SECRET must be at least 32 characters for security'
    },
    DB_PASSWORD: {
      required: true,
      validate: (val) => val && val.length > 0,
      errorMsg: 'DB_PASSWORD is required for database connection'
    },
    DB_USER: {
      required: true,
      validate: (val) => val && val.length > 0,
      errorMsg: 'DB_USER is required for database connection'
    },
    DB_HOST: {
      required: true,
      validate: (val) => val && val.length > 0,
      errorMsg: 'DB_HOST is required for database connection'
    },
    DB_NAME: {
      required: true,
      validate: (val) => val && val.length > 0,
      errorMsg: 'DB_NAME is required for database connection'
    },
    DEPLOYER_PRIVATE_KEY: {
      required: true,
      validate: (val) => val && /^0x[a-fA-F0-9]{64}$/.test(val),
      errorMsg: 'DEPLOYER_PRIVATE_KEY must be a valid 64-character hex string starting with 0x'
    }
  },

  // BLOCKCHAIN: Required for blockchain operations
  BLOCKCHAIN: {
    BLOCKCHAIN_RPC_URL: {
      required: true,
      validate: (val) => val && /^https?:\/\/.+/.test(val),
      errorMsg: 'BLOCKCHAIN_RPC_URL must be a valid HTTP/HTTPS URL'
    },
    ESCROW_CONTRACT_ADDRESS: {
      required: true,
      validate: (val) => val && /^0x[a-fA-F0-9]{40}$/.test(val),
      errorMsg: 'ESCROW_CONTRACT_ADDRESS must be a valid Ethereum address'
    },
    COMPLIANCE_MANAGER_ADDRESS: {
      required: true,
      validate: (val) => val && /^0x[a-fA-F0-9]{40}$/.test(val),
      errorMsg: 'COMPLIANCE_MANAGER_ADDRESS must be a valid Ethereum address'
    },
    FORWARDER_ADDRESS: {
      required: true,
      validate: (val) => val && /^0x[a-fA-F0-9]{40}$/.test(val),
      errorMsg: 'FORWARDER_ADDRESS must be a valid Ethereum address'
    }
  },

  // PRODUCTION_ONLY: Required only in production environment
  PRODUCTION_ONLY: {
    MAILERSEND_API_KEY: {
      required: (env) => env === 'production',
      validate: (val) => !val || val.startsWith('mlsn.'),
      errorMsg: 'MAILERSEND_API_KEY should start with "mlsn." if provided'
    },
    MAILERSEND_SENDER_EMAIL: {
      required: (env) => env === 'production',
      validate: (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      errorMsg: 'MAILERSEND_SENDER_EMAIL must be a valid email address'
    }
  },

  // OPTIONAL: Can have defaults or not required
  OPTIONAL: {
    PORT: {
      required: false,
      validate: (val) => !val || (!isNaN(val) && parseInt(val) > 0 && parseInt(val) < 65536),
      errorMsg: 'PORT must be a valid port number (1-65535)',
      default: '3000'
    },
    NODE_ENV: {
      required: false,
      validate: (val) => !val || ['development', 'staging', 'production', 'test'].includes(val),
      errorMsg: 'NODE_ENV must be one of: development, staging, production, test',
      default: 'development'
    },
    FRONTEND_URL: {
      required: false,
      validate: (val) => !val || /^https?:\/\/.+/.test(val),
      errorMsg: 'FRONTEND_URL must be a valid HTTP/HTTPS URL',
      default: 'http://localhost:5173'
    },
    ALLOWED_ORIGINS: {
      required: false,
      validate: (val) => {
        if (!val) return true;
        const origins = val.split(',');
        return origins.every(origin => /^https?:\/\/.+/.test(origin.trim()));
      },
      errorMsg: 'ALLOWED_ORIGINS must be comma-separated valid HTTP/HTTPS URLs',
      default: 'http://localhost:5173'
    }
  }
};

/**
 * Validates all environment variables based on configuration
 * @returns {Object} { isValid: boolean, errors: string[], warnings: string[] }
 */
function validateEnvironment() {
  const errors = [];
  const warnings = [];
  const nodeEnv = process.env.NODE_ENV || 'development';

  console.log(chalk.blue('\n🔍 Validating environment variables...\n'));

  // Validate CRITICAL variables
  console.log(chalk.yellow('Checking CRITICAL variables:'));
  for (const [key, config] of Object.entries(ENV_CONFIG.CRITICAL)) {
    const value = process.env[key];
    const isRequired = typeof config.required === 'function' 
      ? config.required(nodeEnv) 
      : config.required;

    if (isRequired && !value) {
      errors.push(`❌ ${key} is REQUIRED but not set`);
    } else if (value && config.validate && !config.validate(value)) {
      errors.push(`❌ ${key} is invalid: ${config.errorMsg}`);
    } else if (value) {
      console.log(chalk.green(`  ✓ ${key}`));
    }
  }

  // Validate BLOCKCHAIN variables
  console.log(chalk.yellow('\nChecking BLOCKCHAIN variables:'));
  for (const [key, config] of Object.entries(ENV_CONFIG.BLOCKCHAIN)) {
    const value = process.env[key];
    const isRequired = typeof config.required === 'function' 
      ? config.required(nodeEnv) 
      : config.required;

    if (isRequired && !value) {
      errors.push(`❌ ${key} is REQUIRED but not set`);
    } else if (value && config.validate && !config.validate(value)) {
      errors.push(`❌ ${key} is invalid: ${config.errorMsg}`);
    } else if (value) {
      console.log(chalk.green(`  ✓ ${key}`));
    }
  }

  // Validate PRODUCTION_ONLY variables
  if (nodeEnv === 'production') {
    console.log(chalk.yellow('\nChecking PRODUCTION_ONLY variables:'));
    for (const [key, config] of Object.entries(ENV_CONFIG.PRODUCTION_ONLY)) {
      const value = process.env[key];
      const isRequired = typeof config.required === 'function' 
        ? config.required(nodeEnv) 
        : config.required;

      if (isRequired && !value) {
        errors.push(`❌ ${key} is REQUIRED in production but not set`);
      } else if (value && config.validate && !config.validate(value)) {
        errors.push(`❌ ${key} is invalid: ${config.errorMsg}`);
      } else if (value) {
        console.log(chalk.green(`  ✓ ${key}`));
      }
    }
  }

  // Validate OPTIONAL variables and apply defaults
  console.log(chalk.yellow('\nChecking OPTIONAL variables:'));
  for (const [key, config] of Object.entries(ENV_CONFIG.OPTIONAL)) {
    const value = process.env[key];

    if (!value && config.default) {
      process.env[key] = config.default;
      console.log(chalk.gray(`  ℹ ${key} not set, using default: ${config.default}`));
    } else if (value && config.validate && !config.validate(value)) {
      warnings.push(`⚠️  ${key} is invalid: ${config.errorMsg}`);
    } else if (value) {
      console.log(chalk.green(`  ✓ ${key}`));
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates environment and exits if critical errors found
 */
function validateAndExit() {
  const result = validateEnvironment();

  // Display warnings
  if (result.warnings.length > 0) {
    console.log(chalk.yellow('\n⚠️  WARNINGS:\n'));
    result.warnings.forEach(warning => console.log(chalk.yellow(warning)));
  }

  // Display errors and exit if any
  if (!result.isValid) {
    console.log(chalk.red('\n❌ CRITICAL ERRORS FOUND:\n'));
    result.errors.forEach(error => console.log(chalk.red(error)));
    console.log(chalk.red('\n💥 Application cannot start with missing/invalid environment variables'));
    console.log(chalk.blue('📝 Please check your .env file and ensure all required variables are set\n'));
    process.exit(1);
  }

  console.log(chalk.green('\n✅ All environment variables validated successfully!\n'));
}

module.exports = {
  validateEnvironment,
  validateAndExit
};
