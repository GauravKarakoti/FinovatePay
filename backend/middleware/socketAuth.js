const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

/**
 * Socket.IO Authentication Middleware
 * Verifies JWT token and attaches user to socket instance
 */
const socketAuthMiddleware = async (socket, next) => {
  try {
    // Extract token from handshake auth or query params
    const token = socket.handshake.auth.token || socket.handshake.query.token;

    if (!token) {
      console.warn(`Socket connection rejected: No token provided from ${socket.handshake.address}`);
      return next(new Error('Authentication required'));
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch user from database
    const userResult = await pool.query(
      'SELECT id, email, wallet_address, role, kyc_status, is_frozen FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      console.warn(`Socket connection rejected: User not found for token from ${socket.handshake.address}`);
      return next(new Error('User not found'));
    }

    const user = userResult.rows[0];

    // Check if account is frozen
    if (user.is_frozen) {
      console.warn(`Socket connection rejected: Frozen account ${user.id} from ${socket.handshake.address}`);
      return next(new Error('Account is frozen'));
    }

    // Attach user to socket instance
    socket.user = user;

    console.log(`Socket authenticated: User ${user.id} (${user.email}) connected`);
    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      console.warn(`Socket connection rejected: Invalid token from ${socket.handshake.address}`);
      return next(new Error('Invalid token'));
    }
    if (error.name === 'TokenExpiredError') {
      console.warn(`Socket connection rejected: Expired token from ${socket.handshake.address}`);
      return next(new Error('Token expired'));
    }
    console.error('Socket authentication error:', error);
    return next(new Error('Authentication failed'));
  }
};

/**
 * Verify user has permission to access a specific invoice
 */
const verifyInvoiceAccess = async (userId, userRole, userWalletAddress, invoiceId) => {
  try {
    // Admin can access all invoices
    if (userRole === 'admin') {
      return true;
    }

    // Fetch invoice from database
    const invoiceResult = await pool.query(
      'SELECT seller_address, buyer_address FROM invoices WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceResult.rows.length === 0) {
      return false;
    }

    const invoice = invoiceResult.rows[0];

    // Check if user is buyer or seller
    const isAuthorized = 
      invoice.seller_address === userWalletAddress ||
      invoice.buyer_address === userWalletAddress;

    return isAuthorized;

  } catch (error) {
    console.error('Error verifying invoice access:', error);
    return false;
  }
};

/**
 * Verify user has permission to access marketplace
 */
const verifyMarketplaceAccess = (user) => {
  // Only verified investors and admins can access marketplace
  return user.role === 'investor' || user.role === 'admin';
};

module.exports = {
  socketAuthMiddleware,
  verifyInvoiceAccess,
  verifyMarketplaceAccess
};
