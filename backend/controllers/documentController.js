const storageService = require('../services/storageServices');
const { errorResponse } = require('../utils/errorResponse');
const logger = require('../utils/logger')('documentController');

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Allowed MIME types
const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

exports.uploadDocument = async (req, res) => {
  try {
    // Input validation
    if (!req.file) {
      logger.warn('Document upload attempted without file');
      return errorResponse(res, 'No file uploaded. Please provide a valid file.', 400);
    }

    // Validate file size
    if (req.file.size > MAX_FILE_SIZE) {
      logger.warn(`File size exceeds limit: ${req.file.size} bytes`);
      return errorResponse(res, `File size exceeds maximum limit of ${MAX_FILE_SIZE / 1024 / 1024}MB`, 400);
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
      logger.warn(`Invalid MIME type: ${req.file.mimetype}`);
      return errorResponse(res, `File type not supported. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`, 400);
    }

    // Validate buffer
    if (!req.file.buffer || req.file.buffer.length === 0) {
      logger.error('File buffer is empty or invalid');
      return errorResponse(res, 'File buffer is corrupted or empty', 400);
    }

    logger.info(`Uploading document: ${req.file.originalname}`);

    // Upload to IPFS
    const hash = await storageService.uploadToIPFS(req.file.buffer);

    // Validate hash response
    if (!hash || typeof hash !== 'string') {
      logger.error('Invalid hash returned from storage service', { hash });
      return errorResponse(res, 'Invalid response from storage service', 500);
    }

    logger.info(`Document uploaded successfully: ${hash}`);

    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully',
      hash,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString()
    });

  } catch (err) {
    logger.error('Document upload failed', { error: err.message, stack: err.stack });
    return errorResponse(res, `Document upload failed: ${err.message || 'Unknown error'}`, 500);
  }
};
