const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { adminIpWhitelist } = require('../middleware/ipWhitelist');
const {
    getAllUsers,
    getInvoices,
    freezeAccount,
    unfreezeAccount,
    updateUserRole,
    checkCompliance,
    resolveDispute,
    setInvoiceSpread
} = require('../controllers/adminController');

// Corrected the imported names to match validators.js
const { 
  validateUserId, 
  validateUpdateUserRole, 
  validateResolveDispute 
} = require('../middleware/validators');

// All routes in this file are protected and require admin privileges
// Apply IP whitelist for admin routes (bypassed in development mode)
router.use(adminIpWhitelist());
router.use(authenticateToken, requireRole('admin'));

router.get('/users', getAllUsers);
router.get('/invoices', getInvoices);

// Use the corrected validator names
router.post('/users/:userId/freeze', validateUserId, freezeAccount);
router.post('/users/:userId/unfreeze', validateUserId, unfreezeAccount);
router.put('/users/:userId/role', validateUserId, validateUpdateUserRole, updateUserRole);
router.post('/check-compliance', checkCompliance);
router.post('/resolve-dispute', validateResolveDispute, resolveDispute);

// Notice: authenticateToken is already applied globally for this router above
router.post('/financing/spread', setInvoiceSpread);

module.exports = router;