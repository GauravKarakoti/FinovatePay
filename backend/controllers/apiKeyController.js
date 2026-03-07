const { ApiKey, ApiKeyScopes } = require('../models/ApiKey');
const { AppError, ErrorCodes } = require('../utils/AppError');

/**
 * API Key Controller
 * Handles CRUD operations for API keys.
 */

/**
 * Lists all API keys for the authenticated user.
 * @route GET /api/api-keys
 */
exports.listApiKeys = async (req, res, next) => {
  try {
    const keys = await ApiKey.findByUserId(req.user.id);
    
    res.json({
      success: true,
      keys
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Creates a new API key.
 * @route POST /api/api-keys
 */
exports.createApiKey = async (req, res, next) => {
  try {
    const { name, description, scopes, expiresInDays, testMode } = req.body;

    // Validate required fields
    if (!name) {
      return next(AppError.validation('API key name is required', ErrorCodes.VALIDATION_MISSING_FIELD));
    }

    // Validate scopes
    const validScopes = Object.values(ApiKeyScopes);
    const requestedScopes = scopes || ['read'];
    
    const invalidScopes = requestedScopes.filter(s => !validScopes.includes(s));
    if (invalidScopes.length > 0) {
      return next(AppError.validation(
        `Invalid scopes: ${invalidScopes.join(', ')}. Valid scopes: ${validScopes.join(', ')}`,
        ErrorCodes.VALIDATION_ERROR
      ));
    }

    // Calculate expiration date
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);
    }

    // Determine key prefix
    const prefix = testMode ? 'fp_test' : 'fp_live';

    // Create the API key
    const result = await ApiKey.create({
      userId: req.user.id,
      name,
      description,
      scopes: requestedScopes,
      expiresAt,
      prefix
    });

    // Return the key with the plain text key (only time it will be shown)
    res.status(201).json({
      success: true,
      message: 'API key created successfully. Save this key securely - it will not be shown again.',
      key: {
        id: result.id,
        name: result.name,
        description: result.description,
        scopes: result.scopes,
        prefix: result.key_prefix,
        expiresAt: result.expires_at,
        createdAt: result.created_at,
        key: result.key // Plain text key - only shown once
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Gets a specific API key by ID.
 * @route GET /api/api-keys/:id
 */
exports.getApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const key = await ApiKey.findById(parseInt(id), req.user.id);
    
    if (!key) {
      return next(AppError.notFound('API key not found', ErrorCodes.RESOURCE_NOT_FOUND));
    }
    
    res.json({
      success: true,
      key
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Updates an API key.
 * @route PUT /api/api-keys/:id
 */
exports.updateApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, scopes } = req.body;

    // Validate scopes if provided
    if (scopes) {
      const validScopes = Object.values(ApiKeyScopes);
      const invalidScopes = scopes.filter(s => !validScopes.includes(s));
      
      if (invalidScopes.length > 0) {
        return next(AppError.validation(
          `Invalid scopes: ${invalidScopes.join(', ')}`,
          ErrorCodes.VALIDATION_ERROR
        ));
      }
    }

    const updated = await ApiKey.update(parseInt(id), req.user.id, { name, description, scopes });
    
    if (!updated) {
      return next(AppError.notFound('API key not found or already revoked', ErrorCodes.RESOURCE_NOT_FOUND));
    }
    
    res.json({
      success: true,
      message: 'API key updated successfully',
      key: updated
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Revokes an API key.
 * @route POST /api/api-keys/:id/revoke
 */
exports.revokeApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const revoked = await ApiKey.revoke(parseInt(id), req.user.id, reason || 'user_revoked');
    
    if (!revoked) {
      return next(AppError.notFound('API key not found or already revoked', ErrorCodes.RESOURCE_NOT_FOUND));
    }
    
    res.json({
      success: true,
      message: 'API key revoked successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Deletes an API key.
 * @route DELETE /api/api-keys/:id
 */
exports.deleteApiKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const deleted = await ApiKey.delete(parseInt(id), req.user.id);
    
    if (!deleted) {
      return next(AppError.notFound('API key not found', ErrorCodes.RESOURCE_NOT_FOUND));
    }
    
    res.json({
      success: true,
      message: 'API key deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Gets API key statistics for the user.
 * @route GET /api/api-keys/stats
 */
exports.getApiKeyStats = async (req, res, next) => {
  try {
    const stats = await ApiKey.getStats(req.user.id);
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Returns available API key scopes.
 * @route GET /api/api-keys/scopes
 */
exports.getScopes = async (req, res) => {
  res.json({
    success: true,
    scopes: Object.entries(ApiKeyScopes).map(([name, value]) => ({
      name,
      value,
      description: getScopeDescription(value)
    }))
  });
};

/**
 * Helper to get scope descriptions.
 */
function getScopeDescription(scope) {
  const descriptions = {
    'read': 'Read access to all resources',
    'write': 'Write access to all resources',
    'admin': 'Full administrative access',
    'invoice:read': 'Read access to invoices',
    'invoice:write': 'Create and update invoices',
    'payment:read': 'Read access to payments',
    'payment:write': 'Initiate and manage payments',
    'user:read': 'Read access to user profile',
    'user:write': 'Update user profile'
  };
  
  return descriptions[scope] || scope;
}
