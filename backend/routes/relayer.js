const express = require('express');
const router = express.Router();
const { relayTransaction } = require('../controllers/relayerController');

router.post('/', relayTransaction);

module.exports = router;
