const jwt = require('jsonwebtoken');

// Token expiration configuration
const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
const REFRESH_TOKEN_EXPIRES = process.env.JWT_REFRESH_EXPIRES || '7d';

/**
 * Generates an access token for authentication.
 * Short-lived token for API access.
 * @param {Object} user - User object with id, role, wallet_address
 * @returns {string} JWT access token
 */
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      wallet_address: user.wallet_address || user.walletAddress,
      type: 'access'
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRES }
  );
};

/**
 * Generates a refresh token for token renewal.
 * Long-lived token for obtaining new access tokens.
 * @param {Object} user - User object with id
 * @returns {string} JWT refresh token
 */
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      type: 'refresh'
    },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRES }
  );
};

/**
 * Generates both access and refresh tokens.
 * @param {Object} user - User object
 * @returns {Object} Object containing accessToken and refreshToken
 */
const generateTokens = (user) => {
  return {
    accessToken: generateAccessToken(user),
    refreshToken: generateRefreshToken(user)
  };
};

/**
 * Legacy function for backward compatibility.
 * Generates an access token (was previously a longer-lived token).
 * @deprecated Use generateAccessToken instead
 */
const generateToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      wallet_address: user.wallet_address || user.walletAddress
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

/**
 * Verifies a JWT token.
 * @param {string} token - JWT token to verify
 * @param {string} type - Token type: 'access' or 'refresh'
 * @returns {Object|null} Decoded token payload or null if invalid
 */
const verifyToken = (token, type = 'access') => {
  try {
    const secret = type === 'refresh' 
      ? (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET)
      : process.env.JWT_SECRET;
    
    const decoded = jwt.verify(token, secret);
    
    // Verify token type matches expected type
    if (decoded.type && decoded.type !== type) {
      return null;
    }
    
    return decoded;
  } catch (error) {
    return null;
  }
};

/**
 * Decodes a JWT token without verification (for inspection).
 * @param {string} token - JWT token
 * @returns {Object|null} Decoded payload
 */
const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
};

/**
 * Gets the expiration time for access tokens.
 * @returns {string} Access token expiration string
 */
const getAccessTokenExpiration = () => ACCESS_TOKEN_EXPIRES;

/**
 * Gets the expiration time for refresh tokens.
 * @returns {string} Refresh token expiration string
 */
const getRefreshTokenExpiration = () => REFRESH_TOKEN_EXPIRES;

module.exports = {
  generateToken,
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyToken,
  decodeToken,
  getAccessTokenExpiration,
  getRefreshTokenExpiration
};
