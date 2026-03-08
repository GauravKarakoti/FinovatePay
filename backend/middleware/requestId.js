/**
 * Request ID Middleware for Distributed Tracing
 * Generates or extracts request ID from headers and attaches to all requests
 * Enables tracing requests across frontend → API → blockchain services
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Middleware to generate or extract request ID for distributed tracing
 * - Generates a unique ID for each request if not provided
 * - Extracts existing request ID from X-Request-ID header
 * - Attaches to request and response for correlation
 */
const requestIdMiddleware = (req, res, next) => {
  // Check if request already has X-Request-ID header (from client or upstream service)
  let requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'];

  // Generate new request ID if not provided
  if (!requestId) {
    requestId = uuidv4();
  }

  // Attach to request object for use in all handlers
  req.id = requestId;
  req.requestId = requestId;
  req.correlationId = requestId;

  // Attach request ID to response headers for client to track
  res.setHeader('X-Request-ID', requestId);
  res.setHeader('X-Correlation-ID', requestId);

  // Add request ID to response locals for view rendering
  res.locals.requestId = requestId;

  // Log request with correlation ID
  const logger = require('../utils/logger')('request');
  logger.info(`[${requestId}] ${req.method} ${req.path}`, {
    requestId,
    method: req.method,
    path: req.path,
    ip: getClientIp(req),
  });

  next();
};

/**
 * Utility to extract client IP address from various sources
 */
const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    'unknown'
  );
};

/**
 * Helper function to attach request ID to logs in services
 * Usage: const logger = require('../utils/logger')('service', req.id);
 */
const getRequestIdFromContext = (req) => {
  return req?.id || req?.requestId || 'unknown';
};

module.exports = {
  requestIdMiddleware,
  getClientIp,
  getRequestIdFromContext,
};
