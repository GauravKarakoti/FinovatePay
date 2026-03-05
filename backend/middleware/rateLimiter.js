const rateLimit = require('express-rate-limit');

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
 * Default: 5 requests per 15 minutes per IP
 */
const authLimiter = rateLimit({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS) || 5,
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false, // Count all requests, even successful ones
  handler: (req, res) => {
    console.warn(`Rate limit exceeded for IP: ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many authentication attempts from this IP. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * KYC Rate Limiter
 * Applies to KYC verification endpoints
 * Default: 3 requests per hour per IP
 */
const kycLimiter = rateLimit({
  windowMs: parseInt(process.env.KYC_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.KYC_RATE_LIMIT_MAX_REQUESTS) || 3,
  message: {
    error: 'Too many KYC verification attempts, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`KYC rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many KYC verification attempts. Please try again in an hour.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Payment Rate Limiter
 * Applies to payment and escrow endpoints
 * Default: 20 requests per 15 minutes per IP
 */
const paymentLimiter = rateLimit({
  windowMs: parseInt(process.env.PAYMENT_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.PAYMENT_RATE_LIMIT_MAX_REQUESTS) || 20,
  message: {
    error: 'Too many payment requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Payment rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many payment requests from this IP. Please try again later.',
      retryAfter: req.rateLimit.resetTime
    });
  }
});

/**
 * Relayer Rate Limiter
 * Applies to meta-transaction relay endpoints
 * Default: 10 requests per 15 minutes per IP
 * Strict limit to prevent gas draining attacks
 */
const relayerLimiter = rateLimit({
  windowMs: parseInt(process.env.RELAYER_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RELAYER_RATE_LIMIT_MAX_REQUESTS) || 10,
  message: {
    error: 'Too many relay requests, please try again later.',
    retryAfter: 'Check the Retry-After header for wait time.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    console.warn(`Relayer rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many relay requests from this IP. Please try again later.',
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
