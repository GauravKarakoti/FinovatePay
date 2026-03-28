const multer = require("multer");
const fs = require('fs');
const path = require('path');
const { fileTypeFromBuffer } = require('file-type');

const uploadDir = path.join(__dirname, '../uploads');

if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename to prevent directory traversal or invalid chars
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_'));
  }
});

// Allowed file types with their magic numbers
const ALLOWED_FILE_TYPES = {
  // Images
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  // Documents
  'application/pdf': ['pdf']
};

const fileFilter = (req, file, cb) => {
  // First check: MIME type validation (basic check)
  const mimeType = file.mimetype;
  const isAllowedMime = Object.keys(ALLOWED_FILE_TYPES).includes(mimeType);
  
  if (!isAllowedMime) {
    return cb(new Error('File type not allowed. Only images (JPEG, PNG, GIF, WebP) and PDFs are accepted.'), false);
  }
  
  // Pass initial check - magic number validation will happen after upload
  cb(null, true);
};

// Magic number validation middleware (to be used after multer)
const validateFileType = async (req, res, next) => {
  if (!req.file) {
    return next();
  }

  try {
    // Read file buffer for magic number validation
    const buffer = await fs.promises.readFile(req.file.path);
    const fileType = await fileTypeFromBuffer(buffer);

    if (!fileType) {
      // Delete uploaded file
      await fs.promises.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: 'Unable to determine file type. File may be corrupted or invalid.'
      });
    }

    // Verify the detected file type matches allowed types
    const isAllowed = Object.keys(ALLOWED_FILE_TYPES).some(mimeType => {
      return fileType.mime === mimeType;
    });

    if (!isAllowed) {
      // Delete uploaded file
      await fs.promises.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: `Invalid file type detected. Expected image or PDF, but got ${fileType.mime}. File has been rejected for security reasons.`
      });
    }

    // Verify file extension matches detected type
    const detectedExtension = fileType.ext;
    const allowedExtensions = ALLOWED_FILE_TYPES[fileType.mime];
    
    if (!allowedExtensions.includes(detectedExtension)) {
      // Delete uploaded file
      await fs.promises.unlink(req.file.path);
      return res.status(400).json({
        success: false,
        error: `File extension mismatch. Detected type: ${fileType.mime}, extension: ${detectedExtension}`
      });
    }

    // File is valid - attach detected type to request for logging
    req.file.detectedMimeType = fileType.mime;
    req.file.detectedExtension = fileType.ext;
    
    next();
  } catch (error) {
    console.error('File validation error:', error);
    
    // Clean up file on error
    if (req.file && req.file.path) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting invalid file:', unlinkError);
      }
    }
    
    return res.status(500).json({
      success: false,
      error: 'File validation failed'
    });
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

module.exports = { upload, validateFileType };