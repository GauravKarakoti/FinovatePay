/**
 * API Versioning Middleware
 * Extracts API version from request path and attaches version info to request object
 * Supports URL path versioning: /api/v1/*, /api/v2/*
 */

const API_VERSIONS = {
  v1: {
    version: '1.0.0',
    status: 'current',
    deprecated: false,
    sunsetDate: null
  },
  v2: {
    version: '2.0.0',
    status: 'upcoming',
    deprecated: false,
    sunsetDate: null
  }
};

/**
 * Extract API version from request path
 * @param {string} path - Request path (e.g., '/v1/auth')
 * @returns {object} - Version info object
 */
const extractVersion = (path) => {
  // Match pattern: /v1 or /v2 at the start of the path
  const versionMatch = path.match(/^\/?(v\d+)/);
  
  if (versionMatch) {
    const versionKey = versionMatch[1]; // v1 or v2
    if (API_VERSIONS[versionKey]) {
      return {
        version: API_VERSIONS[versionKey].version,
        versionKey,
        isVersioned: true
      };
    }
  }
  
  // Default to v1 for unversioned routes (backward compatibility)
  return {
    version: API_VERSIONS.v1.version,
    versionKey: 'v1',
    isVersioned: false,
    isLegacy: true
  };
};

/**
 * API Version Middleware
 * Attaches version information to req.apiVersion
 */
const apiVersionMiddleware = (req, res, next) => {
  const versionInfo = extractVersion(req.path);
  
  // Attach version info to request
  req.apiVersion = versionInfo;
  req.apiVersionInfo = API_VERSIONS[versionInfo.versionKey] || API_VERSIONS.v1;
  
  // Log version info in development
  if (process.env.NODE_ENV === 'development') {
    console.log(`[API] ${req.method} ${req.path} - Version: ${versionInfo.version}`);
  }
  
  next();
};

/**
 * Middleware to check if requested version is deprecated
 * Adds deprecation warning headers
 */
const deprecationMiddleware = (req, res, next) => {
  const versionInfo = req.apiVersion;
  
  if (versionInfo && versionInfo.versionKey) {
    const versionData = API_VERSIONS[versionInfo.versionKey];
    
    if (versionData && versionData.deprecated) {
      // Add deprecation headers
      res.set('Deprecation', `date="${new Date().toISOString()}"`);
      
      if (versionData.sunsetDate) {
        res.set('Sunset', versionData.sunsetDate);
        res.set('Link', `<${versionData.sunsetUrl}>; rel="deprecation"`);
      }
      
      // Add deprecation warning to response if not already set
      if (!res.locals.deprecationWarning) {
        res.locals.deprecationWarning = `This API version (${versionInfo.version}) is deprecated. Please update to the latest version.`;
      }
    }
  }
  
  next();
};

/**
 * Get supported API versions
 */
const getSupportedVersions = () => {
  return API_VERSIONS;
};

/**
 * Get latest stable version
 */
const getLatestVersion = () => {
  return 'v1';
};

module.exports = {
  apiVersionMiddleware,
  deprecationMiddleware,
  extractVersion,
  getSupportedVersions,
  getLatestVersion,
  API_VERSIONS
};

