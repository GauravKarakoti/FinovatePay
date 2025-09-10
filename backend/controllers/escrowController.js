const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const pool = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');

// Helper function to convert UUID to bytes32 using ethers v6 syntax
const uuidToBytes32 = (uuid) => {
  // 1. Remove hyphens and prepend '0x'
  const hex = '0x' + uuid.replace(/-/g, '');
  // 2. Pad to 32 bytes
  return ethers.zeroPadValue(hex, 32);
};

exports.releaseEscrow = async (req, res) => {
  try {
    const { invoiceId } = req.body;
    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    // FIX: Convert the UUID string to bytes32
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    const tx = await escrowContract.confirmRelease(bytes32InvoiceId);
    await tx.wait();

    await pool.query(
      'UPDATE invoices SET escrow_status = $1, release_tx_hash = $2 WHERE invoice_id = $3',
      ['released', tx.hash, invoiceId]
    );

    res.json({ success: true, txHash: tx.hash });
  } catch (error) {
    console.error("Error in releaseEscrow:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.raiseDispute = async (req, res) => {
  try {
    const { invoiceId, reason } = req.body;
    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    // FIX: Convert the UUID string to bytes32
    const bytes32InvoiceId = uuidToBytes32(invoiceId);

    const tx = await escrowContract.raiseDispute(bytes32InvoiceId);
    await tx.wait();

    await pool.query(
      'UPDATE invoices SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3 WHERE invoice_id = $4',
      ['disputed', reason, tx.hash, invoiceId]
    );

    res.json({ success: true, txHash: tx.hash });
  } catch (error) {
    console.error("Error in raiseDispute:", error);
    res.status(500).json({ error: error.message });
  }
};