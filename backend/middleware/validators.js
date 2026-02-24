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
 * AUTH VALIDATORS
 */
const validateRegister = [
  body('email')
    .trim()
    .isEmail().withMessage('Invalid email format')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email too long'),
  
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

/**
 * INVOICE VALIDATORS
 */
const validateCreateInvoice = [
  body('quotation_id')
    .isInt({ min: 1 }).withMessage('Invalid quotation ID'),
  
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
    .isISO8601().withMessage('Invalid date format'),
  
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

/**
 * QUOTATION VALIDATORS
 */
const validateCreateQuotation = [
  body('buyer_address')
    .trim()
    .custom(isEthereumAddress).withMessage('Invalid buyer address'),
  
  body('description')
    .trim()
    .isLength({ min: 1, max: 1000 }).withMessage('Description must be 1-1000 characters')
    .escape(),
  
  body('quantity')
    .isFloat({ min: 0.01 }).withMessage('Quantity must be greater than 0'),
  
  body('price_per_unit')
    .isFloat({ min: 0.01 }).withMessage('Price must be greater than 0'),
  
  body('currency')
    .optional()
    .trim()
    .isIn(['USD', 'EUR', 'INR', 'USDC', 'EURC']).withMessage('Invalid currency'),
  
  body('lot_id')
    .optional()
    .isInt({ min: 1 }).withMessage('Invalid lot ID'),
  
  handleValidationErrors
];

const validateQuotationId = [
  param('quotationId')
    .isInt({ min: 1 }).withMessage('Invalid quotation ID'),
  
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
    .isLength({ min: 10, max: 1000 }).withMessage('Dispute reason must be 10-1000 characters')
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
  // Custom validators (export for reuse)
  isEthereumAddress,
  isUUID,
  isAadhaarNumber,
  isOTP
};
