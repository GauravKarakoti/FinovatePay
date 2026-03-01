const storageService = require('../services/storageService');
const errorResponse = require('../utils/errorResponse');

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return errorResponse(res, 'No file uploaded', 400);
    }

    // upload to IPFS
    const hash = await storageService.uploadToIPFS(req.file.buffer);

    // TODO: later integrate smart contract here
    // await contract.storeHash(invoiceId, hash);

    return res.status(200).json({
      message: 'File uploaded successfully',
      hash
    });

  } catch (err) {
    console.error(err);
    return errorResponse(res, 'Upload failed', 500);
  }
};
