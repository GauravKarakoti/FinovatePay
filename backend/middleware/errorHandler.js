const { errorResponse } = require('../utils/errorResponse');
const { AppError } = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  // Log error for debugging
  if (process.env.NODE_ENV === 'development') {
    console.error('[Error]', {
      message: err.message,
      code: err.errorCode,
      stack: err.stack,
      path: req.path,
      method: req.method,
      requestId: req.requestId
    });
  }

  // Preserve CORS-specific handling
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Access denied by CORS policy.',
        code: 'CORS_DENIED'
      }
    });
  }

  // Handle known operational errors
  if (err instanceof AppError) {
    return errorResponse(res, err, err.statusCode);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Invalid token',
        code: 'AUTH_INVALID_TOKEN'
      }
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Token expired',
        code: 'AUTH_TOKEN_EXPIRED'
      }
    });
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(422).json({
      success: false,
      error: {
        message: err.message,
        code: 'VALIDATION_ERROR',
        details: err.details
      }
    });
  }

  // Handle database errors
  if (err.code === '23505') { // PostgreSQL unique violation
    return res.status(409).json({
      success: false,
      error: {
        message: 'Resource already exists',
        code: 'RESOURCE_ALREADY_EXISTS'
      }
    });
  }

  if (err.code === '23503') { // PostgreSQL foreign key violation
    return res.status(400).json({
      success: false,
      error: {
        message: 'Referenced resource not found',
        code: 'RESOURCE_NOT_FOUND'
      }
    });
  }

  // Default to 500 server error
  const statusCode = err.statusCode || 500;

  // Use the centralized error response utility
  return errorResponse(res, err, statusCode);
};

module.exports = errorHandler;
