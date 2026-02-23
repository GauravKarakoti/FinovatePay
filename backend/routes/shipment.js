const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const shipmentController = require('../controllers/shipmentController');

router.post('/location', authenticateToken, requireRole(['shipment', 'seller', 'admin']), shipmentController.updateLocation);

module.exports = router;