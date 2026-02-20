const { getEscrowContract } = require('../config/blockchain');
const Invoice = require('../models/Invoice');
const { ethers } = require('ethers');
const { pool } = require('../config/database');

const uuidToBytes32 = (uuid) => {
  return ethers.zeroPadValue('0x' + uuid.replace(/-/g, ''), 32);
};

const syncInvoiceStatus = async (invoiceId) => {
  try {
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return;

    // Only sync if status is not final
    if (['RELEASED', 'CANCELLED', 'FAILED', 'SETTLED'].includes(invoice.status)) return;

    const contract = getEscrowContract();
    const bytes32Id = uuidToBytes32(invoice.invoice_id);

    // contract.escrows returns array/object based on struct
    // struct Escrow { seller, buyer, amount, token, sellerConfirmed, buyerConfirmed, disputeRaised, ... }
    const escrowData = await contract.escrows(bytes32Id);

    // Check if escrow exists (seller address is not 0x0)
    if (escrowData.seller === ethers.ZeroAddress) {
      // Escrow not created on chain yet
      return;
    }

    let newStatus = invoice.status;

    // Determine status
    if (escrowData.disputeRaised) {
      newStatus = 'DISPUTED';
    } else if (escrowData.sellerConfirmed && escrowData.buyerConfirmed) {
      newStatus = 'RELEASED';
    } else if (escrowData.buyerConfirmed) {
      newStatus = 'ESCROW_LOCKED';
    } else {
      // Created but not deposited
      newStatus = 'PAYMENT_PENDING';
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    // Convert BigInt to number for comparison
    const expiresAt = Number(escrowData.expiresAt);

    if (expiresAt > 0 && expiresAt < now && newStatus !== 'RELEASED' && newStatus !== 'DISPUTED') {
        newStatus = 'CANCELLED';
    }

    if (newStatus !== invoice.status) {
      console.log(`🔄 Syncing Invoice ${invoiceId}: ${invoice.status} -> ${newStatus}`);
      await Invoice.updateStatus(invoiceId, newStatus);
    }

  } catch (error) {
    console.error(`Error syncing invoice ${invoiceId}:`, error.message);
  }
};

const startSyncWorker = () => {
  console.log('👷 Starting Invoice Sync Worker...');
  setInterval(async () => {
    try {
      // Fetch a bounded batch of pending invoices to avoid pulling a huge result set
      const BATCH_SIZE = parseInt(process.env.ESCROW_SYNC_BATCH_SIZE, 10) || 100;
      const CONCURRENCY = parseInt(process.env.ESCROW_SYNC_CONCURRENCY, 10) || 8;

      const result = await pool.query(
        "SELECT invoice_id FROM invoices WHERE status NOT IN ('RELEASED', 'CANCELLED', 'FAILED', 'SETTLED') LIMIT $1",
        [BATCH_SIZE]
      );
      const invoices = result.rows || [];

      // Process invoices in small concurrent batches to balance throughput and RPC load
      const chunkArray = (arr, size) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
        return chunks;
      };

      const invChunks = chunkArray(invoices, CONCURRENCY);
      for (const chunk of invChunks) {
        await Promise.all(chunk.map(inv => syncInvoiceStatus(inv.invoice_id)));
      }
    } catch (err) {
      console.error('Worker Error:', err);
    }
  }, 30000); // 30 seconds
};

module.exports = {
  syncInvoiceStatus,
  startSyncWorker
};
