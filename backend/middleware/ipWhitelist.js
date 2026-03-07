const { AppError, ErrorCodes } = require('../utils/AppError');

/**
 * IP Whitelist Middleware
 * Restricts access to endpoints based on IP address.
 * Supports individual IPs and CIDR notation.
 */

// Parse CIDR notation
const parseCIDR = (cidr) => {
  const [ip, prefix] = cidr.split('/');
  const prefixLen = parseInt(prefix) || 32;
  
  // Convert IP to integer
  const parts = ip.split('.').map(p => parseInt(p));
  const ipInt = (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  
  // Calculate network mask and range
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  const broadcastInt = (networkInt | (~mask >>> 0)) >>> 0;
  
  return { networkInt, broadcastInt };
};

// Convert IP string to integer
const ipToInt = (ip) => {
  const parts = ip.split('.').map(p => parseInt(p));
  return ((parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
};

// Check if IP is in CIDR range
const isIPInCIDR = (ip, cidr) => {
  const ipInt = ipToInt(ip);
  const { networkInt, broadcastInt } = parseCIDR(cidr);
  return ipInt >= networkInt && ipInt <= broadcastInt;
};

// Check if IP matches any allowed pattern
const isIPAllowed = (ip, allowedIPs) => {
  for (const pattern of allowedIPs) {
    if (pattern.includes('/')) {
      // CIDR notation
      if (isIPInCIDR(ip, pattern)) return true;
    } else {
      // Exact match
      if (ip === pattern) return true;
    }
  }
  return false;
};

/**
 * Get client IP from request.
 * Handles various proxy configurations.
 */
const getClientIP = (req) => {
  // Check for forwarded headers first (reverse proxy)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // X-Forwarded-For can contain multiple IPs, first is client
    const ips = forwarded.split(',').map(ip => ip.trim());
    return ips[0];
  }
  
  // Check other common headers
  const realIP = req.headers['x-real-ip'];
  if (realIP) return realIP;
  
  // Fall back to connection remote address
  return req.ip || req.connection?.remoteAddress || '0.0.0.0';
};

/**
 * Parses environment variable IP list into array.
 * @param {string} envVar - Environment variable value
 * @returns {string[]} Array of IP addresses/CIDR ranges
 */
const parseIPList = (envVar) => {
  if (!envVar) return [];
  return envVar
    .split(',')
    .map(ip => ip.trim())
    .filter(ip => ip.length > 0);
};

// Pre-defined whitelists from environment
const ADMIN_WHITELIST = parseIPList(process.env.IP_WHITELIST_ADMIN);
const FINANCIAL_WHITELIST = parseIPList(process.env.IP_WHITELIST_FINANCIAL);
const INTERNAL_WHITELIST = parseIPList(process.env.IP_WHITELIST_INTERNAL);

/**
 * Creates IP whitelist middleware.
 * @param {Object} options - Configuration options
 * @param {string[]} [options.allowedIPs] - Array of allowed IPs/CIDR ranges
 * @param {string} [options.envWhitelist] - Pre-defined whitelist name ('admin', 'financial', 'internal')
 * @param {boolean} [options.bypassInDev=true] - Bypass whitelist in development mode
 * @param {string} [options.message] - Custom error message
 * @returns {Function} Express middleware
 */
const ipWhitelist = (options = {}) => {
  const {
    allowedIPs = [],
    envWhitelist,
    bypassInDev = true,
    message = 'Access denied. IP address not whitelisted.'
  } = options;

  // Get the appropriate whitelist
  let whitelist = allowedIPs;
  if (envWhitelist) {
    switch (envWhitelist) {
      case 'admin':
        whitelist = ADMIN_WHITELIST;
        break;
      case 'financial':
        whitelist = FINANCIAL_WHITELIST;
        break;
      case 'internal':
        whitelist = INTERNAL_WHITELIST;
        break;
      default:
        console.warn(`Unknown env whitelist: ${envWhitelist}`);
    }
  }

  return (req, res, next) => {
    // Bypass in development if configured
    if (bypassInDev && process.env.NODE_ENV !== 'production') {
      return next();
    }

    // If no whitelist configured, allow all (log warning in production)
    if (whitelist.length === 0) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('[Security] IP whitelist is empty. All IPs allowed.');
      }
      return next();
    }

    const clientIP = getClientIP(req);
    
    // Handle IPv6-mapped IPv4 addresses (::ffff:127.0.0.1)
    const ip = clientIP.replace(/^::ffff:/, '');

    if (isIPAllowed(ip, whitelist)) {
      return next();
    }

    // Log rejected access attempt
    console.warn(`[Security] IP whitelist rejected: ${ip} for ${req.method} ${req.path}`);

    return next(AppError.forbidden(message, ErrorCodes.IP_NOT_WHITELISTED));
  };
};

/**
 * Middleware for admin routes using environment whitelist.
 */
const adminIpWhitelist = () => ipWhitelist({
  envWhitelist: 'admin',
  message: 'Admin access is restricted to whitelisted IP addresses.'
});

/**
 * Middleware for financial routes using environment whitelist.
 */
const financialIpWhitelist = () => ipWhitelist({
  envWhitelist: 'financial',
  message: 'Financial operations are restricted to whitelisted IP addresses.'
});

/**
 * Middleware for internal services.
 */
const internalIpWhitelist = () => ipWhitelist({
  envWhitelist: 'internal',
  message: 'Internal services are restricted to whitelisted IP addresses.'
});

/**
 * Creates a middleware that allows localhost only.
 * Useful for development and internal endpoints.
 */
const localhostOnly = () => ipWhitelist({
  allowedIPs: ['127.0.0.1', '::1', 'localhost'],
  bypassInDev: false,
  message: 'This endpoint is restricted to localhost only.'
});

/**
 * Creates a middleware that blocks specific IPs.
 * @param {string[]} blockedIPs - IPs to block
 * @returns {Function} Express middleware
 */
const ipBlacklist = (blockedIPs = []) => {
  return (req, res, next) => {
    const clientIP = getClientIP(req);
    const ip = clientIP.replace(/^::ffff:/, '');

    if (isIPAllowed(ip, blockedIPs)) {
      console.warn(`[Security] IP blocked: ${ip} for ${req.method} ${req.path}`);
      return next(AppError.forbidden('Access denied.', ErrorCodes.IP_NOT_WHITELISTED));
    }

    next();
  };
};

/**
 * Logs client IP for audit purposes.
 * Adds req.clientIP for use in controllers.
 */
const logClientIP = () => {
  return (req, res, next) => {
    req.clientIP = getClientIP(req);
    
    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Request] ${req.method} ${req.path} from ${req.clientIP}`);
    }
    
    next();
  };
};

module.exports = {
  ipWhitelist,
  adminIpWhitelist,
  financialIpWhitelist,
  internalIpWhitelist,
  localhostOnly,
  ipBlacklist,
  logClientIP,
  getClientIP,
  isIPAllowed,
  parseIPList
};
