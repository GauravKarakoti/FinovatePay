const { body, param, query, validationResult } = require('express-validator');
const { pool } = require('../config/database');

/**
 * Validation Error Handler
 * Collects all validation errors and returns them in a structured format
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value
      }))
    });
  }
  next();
};

/**
 * Custom Validators
 */
const isEthereumAddress = (value) => {
  if (!value) return false;
  return /^0x[a-fA-F0-9]{40}$/.test(value);
};

const isUUID = (value) => {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
};

const isAadhaarNumber = (value) => {
  if (!value) return false;
  return /^\d{12}$/.test(value);
};

const isOTP = (value) => {
  if (!value) return false;
  return /^\d{6}$/.test(value);
};

/**
 * Disposable Email Domain Blacklist
 * Common temporary/disposable email services that should be blocked
 * for financial platforms requiring verified user contact information
 */
const DISPOSABLE_EMAIL_DOMAINS = [
  // Popular disposable email services
  'mailinator.com', 'guerrillamail.com', 'temp-mail.org', 'throwaway.email',
  '10minutemail.com', 'tempmail.com', 'fakeinbox.com', 'trashmail.com',
  'yopmail.com', 'maildrop.cc', 'getnada.com', 'sharklasers.com',
  'guerrillamailblock.com', 'pokemail.net', 'spam4.me', 'grr.la',
  'mailnesia.com', 'mintemail.com', 'mytemp.email', 'tempinbox.com',
  'dispostable.com', 'emailondeck.com', 'mohmal.com', 'anonbox.net',
  'burnermail.io', 'mailsac.com', 'mailcatch.com', 'getairmail.com',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz',
  'spam.la', 'tmpeml.info', 'mailforspam.com', 'anonymbox.com',
  'throwawaymail.com', 'tempmail.net', 'fakemailgenerator.com',
  'mailtemp.info', 'emailfake.com', 'tempmailo.com', 'tempr.email',
  'disposablemail.com', 'throwam.com', 'spambox.us', 'mailexpire.com'
];

/**
 * Check if email domain is disposable/temporary
 */
const isDisposableEmail = (email) => {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1];
  return DISPOSABLE_EMAIL_DOMAINS.includes(domain);
};

/**
 * AUTH VALIDATORS
 */
const validateRegister = [
  body('email')
    .trim()
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email too long')
    .custom((value) => {
      if (isDisposableEmail(value)) {
        throw new Error('Disposable email addresses are not allowed. Please use a permanent email address.');
      }
      return true;
    }),
  
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
  
  body('walletAddress')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid Ethereum address format'),
  
  body('company_name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Company name must be 1-255 characters')
    .escape(),
  
  body('tax_id')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 }).withMessage('Tax ID must be 1-50 characters')
    .escape(),
  
  body('first_name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('First name must be 1-100 characters')
    .escape(),
  
  body('last_name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Last name must be 1-100 characters')
    .escape(),
  
  handleValidationErrors
];

const validateLogin = [
  body('email')
    .trim()
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  
  body('password')
    .notEmpty().withMessage('Password is required'),
  
  handleValidationErrors
];

const validateRoleUpdate = [
  body('role')
    .trim()
    .isIn(['buyer', 'seller', 'shipment', 'investor']).withMessage('Invalid role'),
  
  handleValidationErrors
];

const validateCreateInvoice = [
  body('quotation_id')
    // CHANGED: Use isUUID instead of isInt
    .custom(isUUID).withMessage('Invalid quotation ID format'),
  
  body('invoice_id')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('invoice_hash')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Invalid invoice hash'),
  
  body('contract_address')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid contract address'),
  
  body('token_address')
    .optional()
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid token address'),
  
  body('due_date')
    .optional()
    .isISO8601().withMessage('Invalid date format')
    .custom(value => {
      if (new Date(value) < new Date()) {
        throw new Error('Due date must be in future');
      }
      return true;
    }),

  body('discount_rate')
    .optional()
    // CHANGED: Accept basis points (max 10000 = 100.00%)
    .isInt({ min: 0, max: 10000 }).withMessage('Discount rate must be between 0 and 10000 basis points'),

  body('annual_apr')
    .optional()
    .isFloat({ min: 0, max: 100 }).withMessage('Annual APR must be between 0 and 100'),
  
  handleValidationErrors
];

const validateInvoiceId = [
  param('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  handleValidationErrors
];

/**
 * PAYMENT VALIDATORS
 */
const validateDeposit = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('amount')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  
  body('seller_address')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid seller address'),
  
  handleValidationErrors
];

const validateRelease = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  handleValidationErrors
];

const validateDispute = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('reason')
    .trim()
    .isLength({ min: 10, max: 1000 }).withMessage('Reason must be 10-1000 characters')
    .escape(),
  
  handleValidationErrors
];

/**
 * KYC VALIDATORS
 */
const validateInitiateKYC = [
  body('idNumber')
    .trim()
    .custom(isAadhaarNumber).withMessage('Invalid Aadhaar number (must be 12 digits)'),
  
  handleValidationErrors
];

const validateVerifyKYC = [
  body('otp')
    .trim()
    .custom(isOTP).withMessage('Invalid OTP (must be 6 digits)'),
  
  body('referenceId')
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Invalid reference ID')
    .isAlphanumeric().withMessage('Reference ID must be alphanumeric'),
  
  handleValidationErrors
];

/**
 * ADMIN VALIDATORS
 */
const validateUserId = [
  param('userId')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),
  
  handleValidationErrors
];

const validateUpdateUserRole = [
  param('userId')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),
  
  body('role')
    .trim()
    .isIn(['admin', 'buyer', 'seller', 'shipment', 'investor']).withMessage('Invalid role'),
  
  handleValidationErrors
];

const validateResolveDispute = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('sellerWins')
    .isBoolean().withMessage('sellerWins must be boolean'),
  
  handleValidationErrors
];

const validateCreateQuotation = [
  body('buyerAddress')
    .optional()
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid buyer address'),
  
  body('sellerAddress')
    .optional()
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid seller address'),
  
  body('description')
    .trim()
    .isLength({ min: 1, max: 1000 }).withMessage('Description must be 1-1000 characters')
    .escape(),
  
  body('quantity')
    .isFloat({ min: 0 }).withMessage('Quantity must be greater than 0'), // Lowered min to 0
  
  body('pricePerUnit')
    .optional() // Made optional for Flow 1 (Controller assigns Market Price)
    .isFloat({ min: 0 }).withMessage('Price must be a valid number'), // Lowered min to 0
  
  body('currency')
    .optional()
    .trim()
    .isIn(['USD', 'EUR', 'INR', 'USDC', 'EURC', 'MATIC']).withMessage('Invalid currency'),
  
  body('lotId')
    .optional()
    .isInt({ min: 1 }).withMessage('Invalid lot ID'),
  
  handleValidationErrors
];

const validateQuotationId = [
  param('id')
    .custom(isUUID).withMessage('Invalid quotation ID format'),
  handleValidationErrors
];

/**
 * PRODUCE VALIDATORS
 */
const validateCreateProduceLot = [
  body('produce_type')
    .trim()
    .isLength({ min: 1, max: 100 }).withMessage('Produce type must be 1-100 characters')
    .escape(),
  
  body('quantity')
    .isFloat({ min: 0.01 }).withMessage('Quantity must be greater than 0'),
  
  body('origin')
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Origin must be 1-255 characters')
    .escape(),
  
  body('price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Price must be non-negative'),
  
  handleValidationErrors
];

const validateLotId = [
  param('lotId')
    .isInt({ min: 1 }).withMessage('Invalid lot ID'),
  
  handleValidationErrors
];

const validateTransferProduce = [
  body('lotId')
    .isInt({ min: 1 }).withMessage('Invalid lot ID'),
  
  body('to')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid recipient address'),
  
  handleValidationErrors
];

const validateFinancingRequest = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('amount')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  
  body('asset')
    .trim()
    .notEmpty().withMessage('Asset is required'),
    
  body('collateralTokenId')
    .trim()
    .notEmpty().withMessage('Collateral Token ID is required'),
    
  handleValidationErrors
];

const validateFinancingRepay = [
  body('amount')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    
  body('asset')
    .trim()
    .notEmpty().withMessage('Asset is required'),
    
  body('financingId')
    .optional()
    .trim(),
    
  body('invoiceId')
    .optional()
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
    
  handleValidationErrors
];

const validateTokenizeInvoice = [
  body('invoiceId')
    .trim()
    .custom(isUUID).withMessage('Invalid invoice ID format'),
  
  body('faceValue')
    .isFloat({ min: 0.01 }).withMessage('Face value must be greater than 0'),
  
  body('maturityDate')
    .isISO8601().withMessage('Invalid maturity date format'),
  
  handleValidationErrors
];

// ============================================
// RELAYER VALIDATORS
// ============================================

const validateRelayTransaction = [
  body('user')
    .trim()
    .notEmpty().withMessage('User address is required')
    .custom(isEthereumAddress).withMessage('Invalid Ethereum address format'),
  body('functionData')
    .trim()
    .notEmpty().withMessage('Function data is required')
    .matches(/^0x[a-fA-F0-9]+$/).withMessage('Invalid function data format'),
  body('signature')
    .trim()
    .notEmpty().withMessage('Signature is required')
    .matches(/^0x[a-fA-F0-9]{130}$/).withMessage('Invalid signature format (must be 65 bytes)'),
  body('nonce')
    .optional()
    .isInt({ min: 0 }).withMessage('Nonce must be a non-negative integer'),
];

const validateInvoiceStatus = [
  body('status')
    .trim()
    .isIn(['released', 'shipped', 'disputed', 'deposited']).withMessage('Invalid status'),
  
  body('tx_hash')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 }).withMessage('Invalid transaction hash'),
  
  body('dispute_reason')
    .optional()
    .trim()
    .isLength({ min: 1, max: 1000 }).withMessage('Dispute reason must be 10-1000 characters')
    .escape(),
  
  handleValidationErrors
];

const validateOnramp = [
  body('amount')
    .isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
  
  body('currency')
    .trim()
    .isIn(['USD', 'EUR', 'GBP']).withMessage('Invalid currency'),
  
  handleValidationErrors
];

const validateKYCOverride = [
  body('user_id')
    .isInt({ min: 1 }).withMessage('Invalid user ID'),
  
  body('status')
    .trim()
    .isIn(['verified', 'rejected', 'pending', 'failed']).withMessage('Invalid status'),
  
  body('risk_level')
    .trim()
    .isIn(['low', 'medium', 'high']).withMessage('Invalid risk level'),
  
  body('reason')
    .trim()
    .isLength({ min: 3, max: 1000 }).withMessage('Reason must be provided (3-1000 characters)')
    .escape(),
  
  handleValidationErrors
];

const validateWalletAddress = [
  param('wallet')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid wallet address format'),
  
  handleValidationErrors
];

/**
 * PASSWORD RESET VALIDATORS
 */
const validateForgotPassword = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail(),
  handleValidationErrors
];

const validateResetPassword = [
  body('token')
    .trim()
    .notEmpty().withMessage('Reset token is required')
    .isLength({ min: 32, max: 255 }).withMessage('Invalid token format'),
  body('newPassword')
    .trim()
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
  handleValidationErrors
];

const validateChangePassword = [
  body('currentPassword')
    .trim()
    .notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .trim()
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase, and number'),
  body('newPassword').custom((value, { req }) => {
    if (value === req.body.currentPassword) {
      throw new Error('New password must be different from current password');
    }
    return true;
  }),
  handleValidationErrors
];

module.exports = {
  handleValidationErrors,
  // Auth
  validateRegister,
  validateLogin,
  validateRoleUpdate,
  // Invoice
  validateCreateInvoice,
  validateInvoiceId,
  validateInvoiceStatus,
  // Payment
  validateDeposit,
  validateRelease,
  validateDispute,
  validateOnramp,
  // KYC
  validateInitiateKYC,
  validateVerifyKYC,
  validateKYCOverride,    // <-- ADD THIS
  validateWalletAddress,
  // Admin
  validateUserId,
  validateUpdateUserRole,
  validateResolveDispute,
  // Quotation
  validateCreateQuotation,
  validateQuotationId,
  // Produce
  validateCreateProduceLot,
  validateLotId,
  validateTransferProduce,
  // Financing
  validateTokenizeInvoice,
  validateFinancingRequest, // <-- ADD THIS
  validateFinancingRepay,
  // Relayer
  validateRelayTransaction,
  // Password Reset
  validateForgotPassword,
  validateResetPassword,
  validateChangePassword,
  // Custom validators (export for reuse)
  isEthereumAddress,
  isUUID,
  isAadhaarNumber,
  isOTP
};
