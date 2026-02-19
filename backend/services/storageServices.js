const { create } = require('ipfs-http-client');

// public gateway (easy for testing)
const ipfs = create({ url: 'https://ipfs.infura.io:5001/api/v0' });

async function uploadToIPFS(fileBuffer) {
    const result = await ipfs.add(fileBuffer);
    return result.cid.toString(); // this is your hash
}

module.exports = {
    uploadToIPFS
};
