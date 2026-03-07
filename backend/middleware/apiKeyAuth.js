const { ApiKey } = require('../models/ApiKey');
const { AppError, ErrorCodes } = require('../utils/AppError');

/**
 * API Key Authentication Middleware
 * Validates API keys passed in the X-API-Key header.
 */

/**
 * Middleware to authenticate requests using API key.
 * @param {Object} options - Configuration options
 * @param {string[]} [options.requiredScopes] - Required scopes for the endpoint
 * @param {boolean} [options.optional=false] - If true, continues without API key if not provided
 * @returns {Function} Express middleware
 */
const apiKeyAuth = (options = {}) => {
  const { requiredScopes = [], optional = false } = options;

  return async (req, res, next) => {
    try {
      // Get API key from header
      const apiKey = req.headers['x-api-key'];

      // Check if API key is provided
      if (!apiKey) {
        if (optional) {
          return next();
        }
        return next(AppError.unauthorized('API key required', ErrorCodes.API_KEY_MISSING));
      }

      // Validate API key format
      if (!ApiKey.isValidFormat(apiKey)) {
        return next(AppError.unauthorized('Invalid API key format', ErrorCodes.API_KEY_INVALID));
      }

      // Find the API key in database
      const keyRecord = await ApiKey.findValidKey(apiKey);

      if (!keyRecord) {
        return next(AppError.unauthorized('Invalid or expired API key', ErrorCodes.API_KEY_INVALID));
      }

      // Check required scopes
      if (requiredScopes.length > 0) {
        const hasAllScopes = requiredScopes.every(scope => ApiKey.hasScope(keyRecord, scope));
        
        if (!hasAllScopes) {
          return next(AppError.forbidden(
            `API key lacks required scopes: ${requiredScopes.join(', ')}`,
            ErrorCodes.API_KEY_INSUFFICIENT_SCOPE
          ));
        }
      }

      // Update last used timestamp
      const ipAddress = req.ip || req.connection.remoteAddress;
      await ApiKey.updateLastUsed(apiKey, ipAddress);

      // Attach API key info to request
      req.apiKey = {
        id: keyRecord.id,
        userId: keyRecord.user_id,
        name: keyRecord.name,
        scopes: keyRecord.scopes
      };

      // For convenience, also set req.user with API key identity
      // This allows endpoints to work with either JWT auth or API key auth
      req.user = {
        id: keyRecord.user_id,
        authMethod: 'api_key'
      };

      next();
    } catch (error) {
      console.error('API key auth error:', error);
      next(AppError.internal('Failed to authenticate API key', ErrorCodes.INTERNAL_ERROR));
    }
  };
};

/**
 * Middleware factory to require specific scopes.
 * @param {...string} scopes - Required scopes
 * @returns {Function} Express middleware
 */
const requireScopes = (...scopes) => {
  return (req, res, next) => {
    // If authenticated via API key, check scopes
    if (req.apiKey) {
      const hasAllScopes = scopes.every(scope => ApiKey.hasScope({ scopes: req.apiKey.scopes }, scope));
      
      if (!hasAllScopes) {
        return next(AppError.forbidden(
          `Insufficient permissions. Required scopes: ${scopes.join(', ')}`,
          ErrorCodes.API_KEY_INSUFFICIENT_SCOPE
        ));
      }
    }
    
    // If authenticated via JWT, scopes are managed by role
    next();
  };
};

/**
 * Combined authentication middleware.
 * Tries JWT authentication first, falls back to API key.
 * @param {Object} options - Configuration options
 * @param {string[]} [options.requiredScopes] - Required scopes for API key auth
 * @returns {Function[]} Array of Express middleware
 */
const authenticateAny = (options = {}) => {
  const { requiredScopes = [] } = options;
  
  return [
    // First, try to authenticate via API key
    apiKeyAuth({ optional: true, requiredScopes }),
    
    // If API key wasn't used, check for JWT
    async (req, res, next) => {
      if (req.apiKey) {
        // Already authenticated via API key
        return next();
      }
      
      // Try JWT authentication
      const { authenticateToken } = require('./auth');
      return authenticateToken(req, res, next);
    }
  ];
};

/**
 * Middleware to check if request is authenticated via API key.
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next
 */
const isApiKeyRequest = (req, res, next) => {
  req.isApiKeyAuth = !!req.apiKey;
  next();
};

module.exports = {
  apiKeyAuth,
  requireScopes,
  authenticateAny,
  isApiKeyRequest
};
