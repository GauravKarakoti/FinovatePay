/**
 * Audit Middleware - Captures request metadata for audit logging
 * Extracts and stores IP address, user agent, and user information
 */

const getClientIp = (req) => {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.connection.remoteAddress ||
    req.socket.remoteAddress ||
    null
  );
};

const auditMetadataMiddleware = (req, res, next) => {
  // Capture client information
  req.auditData = {
    ipAddress: getClientIp(req),
    userAgent: req.headers['user-agent'] || 'Unknown',
    userId: req.user?.id || req.userId || null,
    userRole: req.user?.role || req.userRole || null,
    userWallet: req.user?.wallet_address || req.userWallet || null,
  };

  next();
};

module.exports = {
  auditMetadataMiddleware,
  getClientIp,
};
