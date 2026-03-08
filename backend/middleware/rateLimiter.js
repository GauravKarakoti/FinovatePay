const rateLimit = require('express-rate-limit');

/**
 * Key generator for authenticated endpoints
 * Combines IP + User ID for authenticated users
 * Falls back to IP only for unauthenticated users
 */
const getAuthenticatedKey = (req) => {
  // If user is authenticated, use IP + User ID
  if (req.user && req.user.id) {
    return `${req.ip}:${req.user.id}`;
  }
  // Fall back to IP only for unauthenticated requests
  return req.ip;
};

/**
 * Key generator with role-based logic
 * Returns IP:user_id for authenticated, IP only for unauthenticated
 */
const getRoleBasedKey = (req, roleMultiplier = 1) => {
  if (req.user && req.user.id) {
    return `${req.ip}:${req.user.id}`;
  }
  return req.ip;
};

/**
 * Global Rate Limiter
 * Applies to all API routes
 * Default: 100 requests per 15 minutes per IP
 */
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  keyGenerator: (req) => req.ip, // IP only for global limiter
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Strict Auth Rate Limiter
 * Applies to authentication endpoints (login, register)
 * IP-based: 5 requests per 15 minutes
 * User-based (for authenticated requests): 20 per 15 minutes
 */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: (req, res) => {
    // Higher limit for authenticated users (combined IP + User ID still counted per user)
    return req.user ? parseInt(process.env.AUTH_RATE_LIMIT_MAX_AUTHENTICATED) || 20 : parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 5;
  },
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests, even successful ones
  keyGenerator: getAuthenticatedKey, // IP + User ID for authenticated endpoints
  handler: (req, res) => {
    const key = getAuthenticatedKey(req);
    console.warn(`Rate limit exceeded for key: ${key} on ${req.path}`);
    res.status(429).json({
      error: 'Too many authentication attempts. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * KYC Rate Limiter
 * Applies to KYC verification endpoints
 * IP-based: 3 requests per hour
 * User-based (for authenticated requests): 5 per hour - prevents user from spamming verification attempts
 */
const kycLimiter = rateLimit({
  windowMs: parseInt(process.env.KYC_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: (req, res) => {
    // Higher limit for authenticated users
    return req.user ? parseInt(process.env.KYC_RATE_LIMIT_MAX_AUTHENTICATED) || 5 : parseInt(process.env.KYC_RATE_LIMIT_MAX_REQUESTS) || 3;
  },
  message: {
    error: 'Too many KYC verification attempts, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAuthenticatedKey, // IP + User ID for authenticated endpoints
  handler: (req, res) => {
    const key = getAuthenticatedKey(req);
    console.warn(`KYC rate limit exceeded for key: ${key}`);
    res.status(429).json({
      error: 'Too many KYC verification attempts. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Payment Rate Limiter
 * Applies to payment and escrow endpoints
 * IP-based: 20 requests per 15 minutes
 * User-based (for authenticated requests): 50 per 15 minutes - prevents per-user abuse
 * VIP users (premium, merchant): 100 per 15 minutes
 */
const paymentLimiter = rateLimit({
  windowMs: parseInt(process.env.PAYMENT_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: (req, res) => {
    // Role-based limits for authenticated users
    if (req.user) {
      const vipRoles = ['premium_buyer', 'merchant', 'producer', 'admin'];
      if (vipRoles.includes(req.user.role)) {
        return parseInt(process.env.PAYMENT_RATE_LIMIT_MAX_VIP) || 100;
      }
      return parseInt(process.env.PAYMENT_RATE_LIMIT_MAX_AUTHENTICATED) || 50;
    }
    // Default IP-based limit for unauthenticated
    return parseInt(process.env.PAYMENT_RATE_LIMIT_MAX_REQUESTS) || 20;
  },
  message: {
    error: 'Too many payment requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAuthenticatedKey, // IP + User ID for authenticated endpoints
  handler: (req, res) => {
    const key = getAuthenticatedKey(req);
    console.warn(`Payment rate limit exceeded for key: ${key}`);
    res.status(429).json({
      error: 'Too many payment requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Relayer Rate Limiter
 * Applies to meta-transaction relay endpoints
 * Strict limit to prevent gas draining attacks
 * IP-based: 10 requests per 15 minutes
 * User-based (for authenticated requests): 30 per 15 minutes - prevents per-user relay spam
 * VIP users (premium, merchant): 50 per 15 minutes
 */
const relayerLimiter = rateLimit({
  windowMs: parseInt(process.env.RELAYER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: (req, res) => {
    // Role-based limits for authenticated users
    if (req.user) {
      const vipRoles = ['premium_buyer', 'merchant', 'producer', 'admin'];
      if (vipRoles.includes(req.user.role)) {
        return parseInt(process.env.RELAYER_RATE_LIMIT_MAX_VIP) || 50;
      }
      return parseInt(process.env.RELAYER_RATE_LIMIT_MAX_AUTHENTICATED) || 30;
    }
    // Default IP-based limit for unauthenticated
    return parseInt(process.env.RELAYER_RATE_LIMIT_MAX_REQUESTS) || 10;
  },
  message: {
    error: 'Too many relay requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getAuthenticatedKey, // IP + User ID for authenticated endpoints
  handler: (req, res) => {
    const key = getAuthenticatedKey(req);
    console.warn(`Relayer rate limit exceeded for key: ${key}`);
    res.status(429).json({
      error: 'Too many relay requests. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Forgot Password Rate Limiter
 * Applies to password reset request endpoint
 * Default: 3 requests per hour per IP
 * Prevents abuse of password reset functionality
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: {
    error: 'Too many password reset requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Forgot password rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many password reset requests from this IP. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Email Test Rate Limiter
 * Applies to test email sending endpoints
 * Default: 3 requests per hour per IP
 * Prevents email bombing and abuse of email service
 */
const emailTestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Max 3 test emails per hour
  message: {
    error: 'Too many test emails sent. Please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Email test rate limit exceeded for user: ${req.user?.id || 'unknown'} from IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many test emails sent from this account. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Push Notification Test Rate Limiter
 * Applies to test push notification endpoints
 * Default: 5 requests per hour per IP
 * Prevents abuse of push notification service
 */
const pushTestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Max 5 test push notifications per hour
  message: {
    error: 'Too many test push notifications sent. Please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Push test rate limit exceeded for user: ${req.user?.id || 'unknown'} from IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many test push notifications sent. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

module.exports = {
  globalLimiter,
  authLimiter,
  kycLimiter,
  paymentLimiter,
  relayerLimiter,
  forgotPasswordLimiter,
  emailTestLimiter,
  pushTestLimiter
};

/**
 * Forgot Password Rate Limiter
 * Applies to password reset request endpoint
 * Default: 3 requests per hour per IP
 * Prevents abuse of password reset functionality
 */
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  message: {
    error: 'Too many password reset requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler: (req, res) => {
    console.warn(`Forgot password rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many password reset requests from this IP. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

module.exports = {
  globalLimiter,
  authLimiter,
  kycLimiter,
  paymentLimiter,
  relayerLimiter,
  forgotPasswordLimiter
};
