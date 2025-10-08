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
} = require('../controllers/adminController');

// All routes in this file are protected and require admin privileges
router.use(authenticateToken, requireRole('admin'));

router.get('/users', getAllUsers);
router.get('/invoices', getInvoices);
router.post('/freeze', freezeAccount);
router.post('/unfreeze', unfreezeAccount);
router.post('/update-role', updateUserRole);
router.post('/check-compliance', checkCompliance);
router.post('/resolve-dispute', resolveDispute);

module.exports = router;