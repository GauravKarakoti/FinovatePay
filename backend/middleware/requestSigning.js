const crypto = require('crypto');
const { AppError, ErrorCodes } = require('../utils/AppError');

/**
 * Request Signing Middleware
 * Validates HMAC signatures on requests for sensitive operations.
 * 
 * Headers used:
 * - X-Signature: The HMAC signature
 * - X-Timestamp: Unix timestamp in milliseconds
 * - X-Signature-Algorithm: Algorithm used (default: HMAC-SHA256)
 */

// Configuration
const SIGNING_SECRET = process.env.REQUEST_SIGNING_SECRET || process.env.JWT_SECRET;
const SIGNING_REQUIRED = process.env.REQUEST_SIGNING_REQUIRED === 'true';
const TIMESTAMP_TOLERANCE_MS = parseInt(process.env.REQUEST_SIGNING_TOLERANCE_MS) || 300000; // 5 minutes

/**
 * Supported signature algorithms
 */
const Algorithms = {
  HMAC_SHA256: 'HMAC-SHA256',
  HMAC_SHA512: 'HMAC-SHA512'
};

/**
 * Computes the signature for a request.
 * @param {Object} params - Request parameters
 * @param {string} params.method - HTTP method
 * @param {string} params.path - Request path
 * @param {string} params.timestamp - Unix timestamp
 * @param {string} params.body - Request body (stringified)
 * @param {string} params.secret - Signing secret
 * @param {string} params.algorithm - Signature algorithm
 * @returns {string} HMAC signature
 */
const computeSignature = ({ method, path, timestamp, body, secret, algorithm = Algorithms.HMAC_SHA256 }) => {
  // Create the payload to sign: timestamp + method + path + body
  const payload = `${timestamp}${method.toUpperCase()}${path}${body || ''}`;
  
  const hashAlgorithm = algorithm === Algorithms.HMAC_SHA512 ? 'sha512' : 'sha256';
  const signature = crypto
    .createHmac(hashAlgorithm, secret)
    .update(payload)
    .digest('hex');
  
  return signature;
};

/**
 * Middleware to verify request signatures.
 * @param {Object} options - Configuration options
 * @param {boolean} [options.required] - Override global requirement setting
 * @param {number} [options.timestampTolerance] - Override global timestamp tolerance
 * @returns {Function} Express middleware
 */
const verifySignature = (options = {}) => {
  const required = options.required !== undefined ? options.required : SIGNING_REQUIRED;
  const timestampTolerance = options.timestampTolerance || TIMESTAMP_TOLERANCE_MS;

  return async (req, res, next) => {
    try {
      const signature = req.headers['x-signature'];
      const timestamp = req.headers['x-timestamp'];
      const algorithm = req.headers['x-signature-algorithm'] || Algorithms.HMAC_SHA256;

      // If signing is not required and no signature provided, skip
      if (!required && !signature) {
        return next();
      }

      // If signing is required but no signature provided
      if (required && !signature) {
        return next(AppError.unauthorized('Request signature required', ErrorCodes.SIGNATURE_MISSING));
      }

      // Validate timestamp presence
      if (!timestamp) {
        return next(AppError.badRequest('Request timestamp required', ErrorCodes.SIGNATURE_MISSING));
      }

      // Validate timestamp format
      const timestampNum = parseInt(timestamp);
      if (isNaN(timestampNum)) {
        return next(AppError.badRequest('Invalid timestamp format', ErrorCodes.SIGNATURE_EXPIRED));
      }

      // Check timestamp is within tolerance
      const now = Date.now();
      const timestampDiff = Math.abs(now - timestampNum);
      
      if (timestampDiff > timestampTolerance) {
        return next(AppError.unauthorized(
          `Request timestamp expired. Max tolerance: ${timestampTolerance / 1000} seconds`,
          ErrorCodes.SIGNATURE_EXPIRED
        ));
      }

      // Validate algorithm
      if (!Object.values(Algorithms).includes(algorithm)) {
        return next(AppError.badRequest(
          `Unsupported signature algorithm. Supported: ${Object.values(Algorithms).join(', ')}`,
          ErrorCodes.INVALID_SIGNATURE
        ));
      }

      // Get request body for signature computation
      const bodyString = req.method !== 'GET' ? JSON.stringify(req.body) : '';

      // Compute expected signature
      const expectedSignature = computeSignature({
        method: req.method,
        path: req.originalUrl || req.path,
        timestamp,
        body: bodyString,
        secret: SIGNING_SECRET,
        algorithm
      });

      // Compare signatures using timing-safe comparison
      const signatureBuffer = Buffer.from(signature, 'hex');
      const expectedBuffer = Buffer.from(expectedSignature, 'hex');

      if (signatureBuffer.length !== expectedBuffer.length) {
        return next(AppError.unauthorized('Invalid signature', ErrorCodes.INVALID_SIGNATURE));
      }

      const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

      if (!isValid) {
        return next(AppError.unauthorized('Invalid signature', ErrorCodes.INVALID_SIGNATURE));
      }

      // Mark request as signed
      req.isSigned = true;
      req.signatureAlgorithm = algorithm;

      next();
    } catch (error) {
      console.error('Signature verification error:', error);
      next(AppError.internal('Failed to verify request signature', ErrorCodes.INTERNAL_ERROR));
    }
  };
};

/**
 * Middleware to require signing for specific routes.
 * @returns {Function} Express middleware
 */
const requireSignature = () => verifySignature({ required: true });

/**
 * Middleware for optional signing.
 * @returns {Function} Express middleware
 */
const optionalSignature = () => verifySignature({ required: false });

/**
 * Signs a request (client-side utility).
 * @param {Object} params - Request parameters
 * @param {string} params.method - HTTP method
 * @param {string} params.path - Request path
 * @param {Object|string} params.body - Request body
 * @param {string} params.secret - Signing secret
 * @param {string} [params.algorithm] - Signature algorithm
 * @returns {Object} Object with signature, timestamp, and algorithm
 */
const signRequest = ({ method, path, body, secret, algorithm = Algorithms.HMAC_SHA256 }) => {
  const timestamp = Date.now().toString();
  const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  
  const signature = computeSignature({
    method,
    path,
    timestamp,
    body: bodyString,
    secret,
    algorithm
  });

  return {
    signature,
    timestamp,
    algorithm
  };
};

module.exports = {
  verifySignature,
  requireSignature,
  optionalSignature,
  signRequest,
  computeSignature,
  Algorithms
};
