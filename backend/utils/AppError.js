/**
 * Standard Error Codes for FinovatePay Backend
 */
const ErrorCodes = {
  // Authentication Errors
  AUTH_INVALID_TOKEN: 'AUTH_INVALID_TOKEN',
  AUTH_TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_INSUFFICIENT_PERMISSIONS',
  AUTH_REFRESH_TOKEN_INVALID: 'AUTH_REFRESH_TOKEN_INVALID',
  AUTH_REFRESH_TOKEN_EXPIRED: 'AUTH_REFRESH_TOKEN_EXPIRED',
  
  // API Key Errors
  API_KEY_INVALID: 'API_KEY_INVALID',
  API_KEY_REVOKED: 'API_KEY_REVOKED',
  API_KEY_EXPIRED: 'API_KEY_EXPIRED',
  API_KEY_MISSING: 'API_KEY_MISSING',
  API_KEY_INSUFFICIENT_SCOPE: 'API_KEY_INSUFFICIENT_SCOPE',
  
  // Validation Errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  VALIDATION_MISSING_FIELD: 'VALIDATION_MISSING_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  
  // Resource Errors
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_FORBIDDEN: 'RESOURCE_FORBIDDEN',
  
  // Rate Limiting
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  
  // IP Whitelist
  IP_NOT_WHITELISTED: 'IP_NOT_WHITELISTED',
  
  // Request Signing
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
  SIGNATURE_MISSING: 'SIGNATURE_MISSING',
  
  // External Services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  BLOCKCHAIN_ERROR: 'BLOCKCHAIN_ERROR',
  DATABASE_ERROR: 'DATABASE_ERROR',
  
  // General Errors
  BAD_REQUEST: 'BAD_REQUEST',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE'
};

/**
 * Enhanced AppError class with standardized error codes.
 * Provides consistent error handling across the application.
 */
class AppError extends Error {
  constructor(message, statusCode, errorCode = 'INTERNAL_ERROR', isOperational = true) {
    super(message);
    
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Creates a 400 Bad Request error
   */
  static badRequest(message = 'Bad request', errorCode = ErrorCodes.BAD_REQUEST) {
    return new AppError(message, 400, errorCode, true);
  }

  /**
   * Creates a 401 Unauthorized error
   */
  static unauthorized(message = 'Unauthorized', errorCode = ErrorCodes.AUTH_INVALID_TOKEN) {
    return new AppError(message, 401, errorCode, true);
  }

  /**
   * Creates a 403 Forbidden error
   */
  static forbidden(message = 'Forbidden', errorCode = ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS) {
    return new AppError(message, 403, errorCode, true);
  }

  /**
   * Creates a 404 Not Found error
   */
  static notFound(message = 'Resource not found', errorCode = ErrorCodes.RESOURCE_NOT_FOUND) {
    return new AppError(message, 404, errorCode, true);
  }

  /**
   * Creates a 409 Conflict error
   */
  static conflict(message = 'Resource already exists', errorCode = ErrorCodes.RESOURCE_ALREADY_EXISTS) {
    return new AppError(message, 409, errorCode, true);
  }

  /**
   * Creates a 422 Validation error
   */
  static validation(message = 'Validation failed', errorCode = ErrorCodes.VALIDATION_ERROR) {
    return new AppError(message, 422, errorCode, true);
  }

  /**
   * Creates a 429 Rate Limit exceeded error
   */
  static rateLimit(message = 'Too many requests', errorCode = ErrorCodes.RATE_LIMIT_EXCEEDED) {
    return new AppError(message, 429, errorCode, true);
  }

  /**
   * Creates a 500 Internal Server error
   */
  static internal(message = 'Internal server error', errorCode = ErrorCodes.INTERNAL_ERROR) {
    return new AppError(message, 500, errorCode, false);
  }

  /**
   * Creates a 503 Service Unavailable error
   */
  static serviceUnavailable(message = 'Service unavailable', errorCode = ErrorCodes.SERVICE_UNAVAILABLE) {
    return new AppError(message, 503, errorCode, true);
  }

  /**
   * Converts error to JSON for API responses
   */
  toJSON() {
    return {
      success: false,
      error: {
        message: this.message,
        code: this.errorCode,
        statusCode: this.statusCode,
        timestamp: this.timestamp,
        ...(process.env.NODE_ENV === 'development' && { stack: this.stack })
      }
    };
  }
}

module.exports = { AppError, ErrorCodes };
