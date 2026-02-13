const express = require('express');
const multer = require('multer');
const router = express.Router();
const documentController = require('../controllers/documentController');

// store file in memory (NOT disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

router.post('/upload', upload.single('file'), documentController.uploadDocument);

module.exports = router;
