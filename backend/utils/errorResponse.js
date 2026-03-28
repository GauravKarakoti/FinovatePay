const { AppError, ErrorCodes } = require('./AppError');

/**
 * Standardized error response utility.
 * Provides consistent API error responses across the application.
 * 
 * @param {Object} res - Express response object
 * @param {Error|AppError|string} error - The error to respond with
 * @param {number} statusCode - HTTP status code (default: 500)
 */
const errorResponse = (res, error, statusCode = 500) => {
  const isDev = process.env.NODE_ENV === 'development';

  // If it's already an AppError, use its built-in formatting
  if (error instanceof AppError) {
    const response = {
      success: false,
      error: {
        message: isDev ? error.message : (error.statusCode >= 500 ? 'Internal server error' : error.message),
        code: error.errorCode
      }
    };

    // Add request ID if available
    if (res.locals?.requestId) {
      response.error.requestId = res.locals.requestId;
    }

    // Add stack trace in development
    if (isDev) {
      response.error.stack = error.stack;
    }

    return res.status(error.statusCode).json(response);
  }

  // Determine the error message
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : 'Internal server error';

  // Determine the appropriate error code based on status code
  let errorCode = ErrorCodes.INTERNAL_ERROR;
  if (statusCode === 400) errorCode = ErrorCodes.BAD_REQUEST;
  else if (statusCode === 401) errorCode = ErrorCodes.AUTH_INVALID_TOKEN;
  else if (statusCode === 403) errorCode = ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS;
  else if (statusCode === 404) errorCode = ErrorCodes.RESOURCE_NOT_FOUND;
  else if (statusCode === 429) errorCode = ErrorCodes.RATE_LIMIT_EXCEEDED;
  else if (statusCode === 503) errorCode = ErrorCodes.SERVICE_UNAVAILABLE;

  // In production, mask 500+ errors with a generic message
  const finalMessage =
    !isDev && statusCode >= 500 ? 'Internal server error' : message;

  const response = {
    success: false,
    error: {
      message: finalMessage,
      code: errorCode
    }
  };

  // Add request ID if available
  if (res.locals?.requestId) {
    response.error.requestId = res.locals.requestId;
  }

  // Add stack trace in development for Error instances
  if (isDev && error instanceof Error) {
    response.error.stack = error.stack;
  }

  return res.status(statusCode).json(response);
};

/**
 * Creates a standardized error response for validation errors.
 * @param {Object} res - Express response object
 * @param {Array} errors - Array of validation errors
 */
const validationErrorResponse = (res, errors) => {
  return res.status(422).json({
    success: false,
    error: {
      message: 'Validation failed',
      code: ErrorCodes.VALIDATION_ERROR,
      details: errors
    }
  });
};

/**
 * Creates a standardized error response for not found resources.
 * @param {Object} res - Express response object
 * @param {string} resource - Name of the resource not found
 */
const notFoundResponse = (res, resource = 'Resource') => {
  return res.status(404).json({
    success: false,
    error: {
      message: `${resource} not found`,
      code: ErrorCodes.RESOURCE_NOT_FOUND
    }
  });
};

/**
 * Creates a standardized error response for unauthorized access.
 * @param {Object} res - Express response object
 * @param {string} message - Custom error message
 */
const unauthorizedResponse = (res, message = 'Unauthorized') => {
  return res.status(401).json({
    success: false,
    error: {
      message,
      code: ErrorCodes.AUTH_INVALID_TOKEN
    }
  });
};

/**
 * Creates a standardized error response for forbidden access.
 * @param {Object} res - Express response object
 * @param {string} message - Custom error message
 */
const forbiddenResponse = (res, message = 'Forbidden') => {
  return res.status(403).json({
    success: false,
    error: {
      message,
      code: ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS
    }
  });
};

module.exports = {
  errorResponse,
  validationErrorResponse,
  notFoundResponse,
  unauthorizedResponse,
  forbiddenResponse
};
