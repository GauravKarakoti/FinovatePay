/**
 * Versioned Response Middleware
 * Adds API version information to all responses
 * Includes version in response headers and payload
 */

const { getLatestVersion, API_VERSIONS } = require('./apiVersion');

/**
 * Wrap res.json to inject version info into response payload
 */
const versionedResponse = (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    // Get version info from request (set by apiVersion middleware)
    const versionInfo = req.apiVersion || { version: '1.0.0', versionKey: 'v1' };
    const versionData = API_VERSIONS[versionInfo.versionKey] || API_VERSIONS.v1;
    
    // Add version headers to response
    res.set('X-API-Version', versionInfo.version);
    res.set('X-API-Version-Key', versionInfo.versionKey || 'v1');
    
    // Add deprecation headers if version is deprecated
    if (versionData.deprecated) {
      res.set('Deprecation', 'true');
      if (versionData.sunsetDate) {
        res.set('Sunset', versionData.sunsetDate);
      }
    }
    
    // Inject version info into response payload
    // Only inject if data is an object and not null
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const versionedData = {
        ...data,
        apiVersion: versionInfo.version,
        _versionInfo: {
          version: versionInfo.version,
          timestamp: new Date().toISOString()
        }
      };
      
      // Add deprecation warning if applicable
      if (versionData.deprecated && res.locals.deprecationWarning) {
        versionedData.deprecationWarning = res.locals.deprecationWarning;
      }
      
      return originalJson.call(this, versionedData);
    }
    
    // For arrays or other data types, wrap in versioned structure
    return originalJson.call(this, {
      data,
      apiVersion: versionInfo.version,
      _versionInfo: {
        version: versionInfo.version,
        timestamp: new Date().toISOString()
      }
    });
  };
  
  next();
};

/**
 * Middleware to add CORS headers for API versioning
 * Allows clients to discover available versions
 */
const versionCorsMiddleware = (req, res, next) => {
  // Add custom header listing supported versions
  res.set('X-API-Supported-Versions', Object.keys(API_VERSIONS).join(', '));
  res.set('X-API-Latest-Version', getLatestVersion());
  
  next();
};

/**
 * Middleware to handle version negotiation
 * Returns 406 if requested version is not supported
 */
const versionNegotiationMiddleware = (req, res, next) => {
  const requestedVersion = req.headers['accept-version'];
  
  if (requestedVersion) {
    const supportedVersions = Object.keys(API_VERSIONS);
    
    if (!supportedVersions.includes(requestedVersion)) {
      return res.status(406).json({
        error: 'Not Acceptable',
        message: `API version '${requestedVersion}' is not supported`,
        supportedVersions,
        latestVersion: getLatestVersion()
      });
    }
  }
  
  next();
};

/**
 * Utility function to create versioned route handler
 * Automatically applies version headers to all responses
 */
const createVersionedHandler = (handler) => {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      // Add version info to error responses
      const versionInfo = req.apiVersion || { version: '1.0.0', versionKey: 'v1' };
      res.set('X-API-Version', versionInfo.version);
      next(error);
    }
  };
};

module.exports = {
  versionedResponse,
  versionCorsMiddleware,
  versionNegotiationMiddleware,
  createVersionedHandler
};

