const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
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

// All routes in this file are protected and require admin privileges
router.use(authenticateToken, requireRole('admin'));

router.get('/users', getAllUsers);
router.get('/invoices', getInvoices);
router.post('/users/:userId/freeze', freezeAccount);
router.post('/users/:userId/unfreeze', unfreezeAccount);
router.put('/users/:userId/role', updateUserRole);
router.post('/check-compliance', checkCompliance);
router.post('/resolve-dispute', resolveDispute);
router.post('/financing/spread', authenticateToken, setInvoiceSpread);

module.exports = router;