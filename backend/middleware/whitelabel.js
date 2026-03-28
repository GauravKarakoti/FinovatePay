/**
 * Whitelabel Middleware
 * 
 * Detects and applies white-label configuration based on request domain
 */

const Whitelabel = require('../models/Whitelabel');

// Cache for whitelabel configurations (5 minutes TTL)
const configCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Extract domain from request
 * @param {Request} req - Express request object
 * @returns {string} Domain name
 */
const extractDomain = (req) => {
  // Check various sources for the domain
  const sources = [
    req.headers['x-forwarded-host'],
    req.headers.host,
    req.hostname,
  ];

  for (const source of sources) {
    if (source) {
      // Remove port if present
      return source.split(':')[0].toLowerCase();
    }
  }

  return 'localhost';
};

/**
 * Get whitelabel configuration with caching
 * @param {string} domain - Domain name
 * @returns {Promise<Object|null>}
 */
const getCachedConfig = async (domain) => {
  const cacheKey = domain;
  const cached = configCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.config;
  }

  const config = await Whitelabel.getConfigurationByDomain(domain);

  configCache.set(cacheKey, {
    config,
    timestamp: Date.now(),
  });

  return config;
};

/**
 * Middleware to detect and attach whitelabel configuration to request
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Next middleware function
 */
const whitelabelMiddleware = async (req, res, next) => {
  try {
    const domain = extractDomain(req);
    const config = await getCachedConfig(domain);

    if (config) {
      req.whitelabel = {
        organizationId: config.organization_id,
        organizationName: config.organization_name,
        organizationSlug: config.organization_slug,
        config: {
          brandName: config.brand_name,
          logoUrl: config.logo_url,
          logoDarkUrl: config.logo_dark_url,
          primaryColor: config.primary_color,
          secondaryColor: config.secondary_color,
          accentColor: config.accent_color,
          backgroundColor: config.background_color,
          textColor: config.text_color,
          fontFamily: config.font_family,
          borderRadius: config.border_radius,
          customCss: config.custom_css,
          showPoweredBy: config.show_powered_by,
          features: config.features,
        },
      };

      // Also set headers for frontend consumption
      res.set('X-Whitelabel-Brand', config.brand_name || 'FinovatePay');
    } else {
      req.whitelabel = null;
    }

    next();
  } catch (error) {
    console.error('[WhitelabelMiddleware] Error:', error);
    // Continue without whitelabel config rather than failing
    req.whitelabel = null;
    next();
  }
};

/**
 * Middleware to restrict access to specific organizations
 * @param {string|string[]} allowedSlugs - Allowed organization slugs
 * @returns {Function} Express middleware
 */
const restrictToOrganization = (allowedSlugs) => {
  const slugs = Array.isArray(allowedSlugs) ? allowedSlugs : [allowedSlugs];

  return (req, res, next) => {
    if (!req.whitelabel) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (!slugs.includes(req.whitelabel.organizationSlug)) {
      return res.status(404).json({ error: 'Not found' });
    }

    next();
  };
};

/**
 * Middleware to check organization features
 * @param {string} feature - Feature name to check
 * @returns {Function} Express middleware
 */
const requireFeature = (feature) => {
  return (req, res, next) => {
    if (!req.whitelabel) {
      // Allow if no whitelabel (default config)
      return next();
    }

    const features = req.whitelabel.config.features || {};
    if (features[feature] === false) {
      return res.status(403).json({
        error: 'This feature is not enabled for your organization',
        feature,
      });
    }

    next();
  };
};

/**
 * Clear the whitelabel config cache
 * @param {string} [domain] - Optional specific domain to clear
 */
const clearCache = (domain) => {
  if (domain) {
    configCache.delete(domain);
  } else {
    configCache.clear();
  }
};

/**
 * Get current user's organization configuration
 * @param {Request} req - Express request object
 * @returns {Promise<Object|null>}
 */
const getUserOrganizationConfig = async (req) => {
  if (!req.user?.organization_id) {
    return null;
  }

  const config = await Whitelabel.getConfiguration(req.user.organization_id);
  return config;
};

module.exports = {
  whitelabelMiddleware,
  restrictToOrganization,
  requireFeature,
  clearCache,
  extractDomain,
  getUserOrganizationConfig,
};
