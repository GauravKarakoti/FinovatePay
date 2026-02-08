const express = require('express');
const multer = require('multer');
const router = express.Router();

const upload = multer({ dest: 'uploads/' });

/* 1. Get dispute details */
router.get('/:invoiceId', async (req, res) => {
  // fetch dispute + logs from DB
  res.json({ dispute: {}, logs: [], evidence: [] });
});

/* 2. Upload evidence */
router.post('/:invoiceId/evidence', upload.single('file'), async (req, res) => {
  res.json({ success: true, file: req.file.filename });
});

/* 3. Add audit log */
router.post('/:invoiceId/log', async (req, res) => {
  const { message } = req.body;
  res.json({ success: true });
});

module.exports = router;
