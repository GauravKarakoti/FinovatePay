const { getProvider, getEscrowContract } = require('../config/blockchain');
const { pool } = require('../config/database');
const Invoice = require('../models/Invoice');

/**
 * Fetch on-chain features related to a user using DB invoice linkage and RPC queries.
 * Returns a compact feature object used by the ML service.
 */
const fetchOnchainFeatures = async ({ userId, walletAddress }) => {
  const client = await pool.connect();
  try {
    // If walletAddress not provided, try to lookup from users table
    let wallet = walletAddress;
    if (!wallet) {
      const ures = await client.query('SELECT wallet_address FROM users WHERE id = $1', [userId]);
      wallet = ures.rows[0]?.wallet_address || null;
    }

    // Basic RPC-derived metrics
    const provider = getProvider();
    let txCount = 0;
    try {
      if (wallet) txCount = await provider.getTransactionCount(wallet);
    } catch (err) {
      console.warn('[onchainFetcher] Failed to get txCount:', err.message);
      txCount = 0;
    }

    // Use existing invoices to determine on-chain escrow involvement
    const invRes = await client.query(
      `SELECT invoice_id, CAST(amount AS NUMERIC) as amount FROM invoices WHERE seller_id = $1 OR buyer_id = $1`,
      [userId]
    );

    const invoices = invRes.rows || [];
    const escrowContract = getEscrowContract();

    let escrowOnchainCount = 0;
    let escrowOnchainVolume = 0;

    for (const inv of invoices) {
      try {
        // invoice id is UUID string; contract.escrows expects bytes32
        const idHex = '0x' + inv.invoice_id.replace(/-/g, '');
        const esc = await escrowContract.escrows(idHex);
        // seller address zero indicates not created
        if (esc && esc.seller && esc.seller !== '0x0000000000000000000000000000000000000000') {
          escrowOnchainCount += 1;
          escrowOnchainVolume += Number(inv.amount || 0);
        }
      } catch (err) {
        // ignore individual failures
      }
    }

    return {
      wallet_address: wallet,
      tx_count: Number(txCount || 0),
      escrow_onchain_count: escrowOnchainCount,
      escrow_onchain_volume: escrowOnchainVolume,
      cross_chain_activity: 0 // placeholder (requires external indexer)
    };
  } finally {
    client.release();
  }
};

module.exports = {
  fetchOnchainFeatures
};
