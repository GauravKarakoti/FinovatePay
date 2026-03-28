const crypto = require('crypto');

/**
 * Request Signer Utility
 * Client-side utility for signing API requests.
 */

const Algorithms = {
  HMAC_SHA256: 'HMAC-SHA256',
  HMAC_SHA512: 'HMAC-SHA512'
};

/**
 * Signs a request for sending to the API.
 * @param {Object} options - Signing options
 * @param {string} options.method - HTTP method (GET, POST, PUT, DELETE, etc.)
 * @param {string} options.path - Request path (e.g., '/api/invoices')
 * @param {Object|string} [options.body] - Request body (optional for GET requests)
 * @param {string} options.secret - Your signing secret
 * @param {string} [options.algorithm='HMAC-SHA256'] - Signature algorithm
 * @returns {Object} Headers to add to your request
 */
const signRequest = ({ method, path, body, secret, algorithm = Algorithms.HMAC_SHA256 }) => {
  const timestamp = Date.now().toString();
  const bodyString = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  
  // Create payload: timestamp + method + path + body
  const payload = `${timestamp}${method.toUpperCase()}${path}${bodyString}`;
  
  // Compute signature
  const hashAlgorithm = algorithm === Algorithms.HMAC_SHA512 ? 'sha512' : 'sha256';
  const signature = crypto
    .createHmac(hashAlgorithm, secret)
    .update(payload)
    .digest('hex');

  return {
    'X-Signature': signature,
    'X-Timestamp': timestamp,
    'X-Signature-Algorithm': algorithm
  };
};

/**
 * Signs an axios-style request config.
 * @param {Object} config - Axios request config
 * @param {string} secret - Your signing secret
 * @param {string} [algorithm] - Signature algorithm
 * @returns {Object} Modified config with signature headers
 */
const signAxiosRequest = (config, secret, algorithm = Algorithms.HMAC_SHA256) => {
  const headers = signRequest({
    method: config.method || 'GET',
    path: config.url,
    body: config.data,
    secret,
    algorithm
  });

  return {
    ...config,
    headers: {
      ...config.headers,
      ...headers
    }
  };
};

/**
 * Signs a fetch-style request.
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @param {string} secret - Your signing secret
 * @param {string} [algorithm] - Signature algorithm
 * @returns {Object} Modified fetch options with signature headers
 */
const signFetchRequest = (url, options, secret, algorithm = Algorithms.HMAC_SHA256) => {
  const urlObj = new URL(url);
  const headers = signRequest({
    method: options.method || 'GET',
    path: urlObj.pathname + urlObj.search,
    body: options.body,
    secret,
    algorithm
  });

  return {
    ...options,
    headers: {
      ...options.headers,
      ...headers
    }
  };
};

/**
 * Verifies a signature (for webhook handlers, etc.).
 * @param {Object} options - Verification options
 * @param {string} options.signature - The signature to verify
 * @param {string} options.timestamp - The timestamp from the request
 * @param {string} options.method - HTTP method
 * @param {string} options.path - Request path
 * @param {string} [options.body] - Request body
 * @param {string} options.secret - Signing secret
 * @param {string} [options.algorithm] - Signature algorithm
 * @param {number} [options.tolerance=300000] - Timestamp tolerance in milliseconds
 * @returns {Object} Verification result { valid: boolean, error?: string }
 */
const verifySignature = ({ 
  signature, 
  timestamp, 
  method, 
  path, 
  body, 
  secret, 
  algorithm = Algorithms.HMAC_SHA256,
  tolerance = 300000 // 5 minutes
}) => {
  try {
    // Check timestamp
    const timestampNum = parseInt(timestamp);
    if (isNaN(timestampNum)) {
      return { valid: false, error: 'Invalid timestamp format' };
    }

    const now = Date.now();
    if (Math.abs(now - timestampNum) > tolerance) {
      return { valid: false, error: 'Timestamp expired' };
    }

    // Compute expected signature
    const bodyString = body || '';
    const payload = `${timestamp}${method.toUpperCase()}${path}${bodyString}`;
    const hashAlgorithm = algorithm === Algorithms.HMAC_SHA512 ? 'sha512' : 'sha256';
    const expectedSignature = crypto
      .createHmac(hashAlgorithm, secret)
      .update(payload)
      .digest('hex');

    // Compare signatures
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Invalid signature' };
    }

    const isValid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    
    return { valid: isValid, error: isValid ? undefined : 'Invalid signature' };
  } catch (error) {
    return { valid: false, error: error.message };
  }
};

module.exports = {
  signRequest,
  signAxiosRequest,
  signFetchRequest,
  verifySignature,
  Algorithms
};
