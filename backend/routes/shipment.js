const express = require('express');
const router = express.Router();
const shipmentController = require('../controllers/shipmentController');

// Add this line to see what's being imported
console.log('Imported shipmentController:', shipmentController);

router.post('/location', shipmentController.updateLocation);

module.exports = router;