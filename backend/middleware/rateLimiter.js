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

module.exports = {
  globalLimiter,
  authLimiter,
  kycLimiter,
  paymentLimiter
};
