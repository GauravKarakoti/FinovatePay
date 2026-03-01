const errorResponse = (res, error, statusCode = 500) => {
  const isDev = process.env.NODE_ENV === 'development';

  // Determine the error message
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : 'Internal server error';

  // In production, mask 500+ errors with a generic message
  const finalMessage =
    !isDev && statusCode >= 500 ? 'Internal server error' : message;

  return res.status(statusCode).json({
    success: false,
    error: finalMessage,
  });
};

module.exports = errorResponse;
