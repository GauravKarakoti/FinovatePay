const storageService = require('../services/storageService');

exports.uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
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
    return res.status(500).json({ error: 'Upload failed' });
  }
};
