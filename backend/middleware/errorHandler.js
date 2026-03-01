const errorResponse = require('../utils/errorResponse');

const errorHandler = (err, req, res, next) => {
  // Preserve CORS-specific handling
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      message: 'Access denied by CORS policy.'
    });
  }

  const statusCode = err.statusCode || 500;

  // Use the centralized error response utility
  return errorResponse(res, err, statusCode);
};

module.exports = errorHandler;
