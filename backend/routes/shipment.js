const express = require('express');
const router = express.Router();
const shipmentController = require('../controllers/shipmentController');

router.post('/location', shipmentController.updateLocation);

module.exports = router;