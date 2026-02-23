const errorHandler = (err, req, res, next) => {
  // Preserve CORS-specific handling
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'Access denied by CORS policy.'
    });
  }

  // Log the error for internal tracking
  console.error(err);

  const statusCode = err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  let errorMessage = err.message || 'Internal Server Error';

  // Secure 5xx errors in production
  if (isProduction && statusCode >= 500) {
    errorMessage = 'Internal Server Error';
  }

  res.status(statusCode).json({
    success: false,
    error: errorMessage
  });
};

module.exports = errorHandler;
