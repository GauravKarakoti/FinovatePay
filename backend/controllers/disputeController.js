const { pool } = require('../config/database');
const { ethers } = require('ethers');
const { getSigner, getEscrowContract } = require('../config/blockchain');

// Helper function to create a log entry
const createLog = async (client, invoiceId, action, performedBy, notes) => {
  await client.query(
    'INSERT INTO dispute_logs (invoice_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)',
    [invoiceId, action, performedBy, notes]
  );
};

// Helper function to convert UUID to bytes32 (consistent with other controllers)
const uuidToBytes32 = (uuid) => {
    // 1. Remove hyphens and prepend '0x'
    const hex = '0x' + uuid.replace(/-/g, '');
    // 2. Pad to 32 bytes
    return ethers.zeroPadValue(hex, 32);
};

exports.raiseDispute = async (req, res) => {
  const { invoiceId } = req.params;
  const { reason } = req.body;
  const user = req.user; // Assuming auth middleware populates this

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if a dispute already exists
    const check = await client.query('SELECT * FROM disputes WHERE invoice_id = $1', [invoiceId]);
    if (check.rows.length > 0) {
      throw new Error('Dispute already exists for this invoice.');
    }

    // Create the dispute
    await client.query(
      'INSERT INTO disputes (invoice_id, status, resolution_note) VALUES ($1, $2, $3)',
      [invoiceId, 'open', reason]
    );

    // Add log entry
    await createLog(client, invoiceId, 'Dispute Raised', user.email, reason);

    await client.query('COMMIT');

    // Notify via Socket.io
    const io = req.app.get('io');
    if (io) {
        io.to(`invoice-${invoiceId}`).emit('dispute-updated', { type: 'RAISED', invoiceId, reason });
    }

    res.json({ success: true, message: 'Dispute raised successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error raising dispute:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.uploadEvidence = async (req, res) => {
  const { invoiceId } = req.params;
  const file = req.file;
  const user = req.user;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Automatically create a dispute if it doesn't exist?
    // For now, let's assume raising a dispute is explicit, but we allow evidence upload even if not raised yet?
    // Or we can check. Let's create it if it doesn't exist to be safe, as "evidence" implies a dispute context.
    // However, usually you raise first. I'll check if dispute exists, if not, I'll create it with "Evidence Upload" as reason/note.

    let disputeCheck = await client.query('SELECT * FROM disputes WHERE invoice_id = $1', [invoiceId]);
    if (disputeCheck.rows.length === 0) {
       await client.query(
        'INSERT INTO disputes (invoice_id, status, resolution_note) VALUES ($1, $2, $3)',
        [invoiceId, 'open', 'Auto-created by evidence upload']
      );
      await createLog(client, invoiceId, 'Dispute Auto-Created', user.email, 'Created by evidence upload');
    }

    // Save evidence record
    const fileUrl = `/uploads/${file.filename}`;
    await client.query(
      'INSERT INTO dispute_evidence (invoice_id, uploaded_by, file_url, file_name) VALUES ($1, $2, $3, $4)',
      [invoiceId, user.email, fileUrl, file.originalname]
    );

    // Add log entry
    await createLog(client, invoiceId, 'Evidence Uploaded', user.email, `Uploaded ${file.originalname}`);

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) {
        io.to(`invoice-${invoiceId}`).emit('dispute-updated', { type: 'EVIDENCE', invoiceId, fileUrl });
    }

    res.json({ success: true, file: fileUrl });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error uploading evidence:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getEvidence = async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM dispute_evidence WHERE invoice_id = $1 ORDER BY created_at DESC', [invoiceId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching evidence:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getLogs = async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const result = await pool.query('SELECT * FROM dispute_logs WHERE invoice_id = $1 ORDER BY timestamp ASC', [invoiceId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.resolveDispute = async (req, res) => {
  const { invoiceId } = req.params;
  const { status, notes } = req.body; // status: 'resolved' or 'rejected'
  const user = req.user;

  // Additional role check just in case, though middleware should handle it
  if (user.role !== 'arbitrator') {
    return res.status(403).json({ error: 'Only arbitrators can resolve disputes' });
  }

  // Determine winner for Smart Contract
  let sellerWins;
  if (status === 'resolved') {
      sellerWins = false; // Resolved in favor of Buyer (Refund)
  } else if (status === 'rejected') {
      sellerWins = true; // Dispute Rejected, Seller keeps funds
  } else {
      return res.status(400).json({ error: 'Invalid resolution status' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Interactions with Blockchain
    try {
        const signer = getSigner();
        const escrowContract = getEscrowContract(signer);

        const bytes32InvoiceId = uuidToBytes32(invoiceId);

        console.log(`Resolving on-chain: Invoice ${invoiceId} -> ${sellerWins ? 'Seller Wins' : 'Buyer Wins'}`);
        
        // Admin acts as the Arbitrator here
        const tx = await escrowContract.voteOnDispute(bytes32InvoiceId, sellerWins);
        console.log(`Transaction sent: ${tx.hash}`);
        
        await tx.wait();
        console.log('Transaction confirmed on-chain');

    } catch (bcError) {
        console.error('Blockchain interaction failed:', bcError);
        throw new Error(`Blockchain sync failed: ${bcError.message}`);
    }

    // 2. Update Database
    await client.query(
      'UPDATE disputes SET status = $1, resolved_by = $2, resolution_note = $3, updated_at = NOW() WHERE invoice_id = $4',
      [status, user.email, notes, invoiceId]
    );

    // Update invoice status if needed? Usually dispute resolution handles payout, so invoice might need separate status update?
    // The event listener 'DisputeResolved' on backend might handle invoice status update separately.
    // But we can do it here for immediate consistency if listener is slow.
    // However, adhering to Single Source of Truth (Blockchain), we should rely on listener or just update dispute record.
    // The `disputes` table update is sufficient for this controller's scope.

    await createLog(client, invoiceId, `Dispute ${status.charAt(0).toUpperCase() + status.slice(1)}`, user.email, notes);

    await client.query('COMMIT');

    const io = req.app.get('io');
    if (io) {
        io.to(`invoice-${invoiceId}`).emit('dispute-updated', { type: 'RESOLVED', invoiceId, status });
    }

    res.json({ success: true, txHash: 'Synced via Blockchain' }); // Or send actual hash if captured
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error resolving dispute:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

exports.getDisputeStatus = async (req, res) => {
    const { invoiceId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM disputes WHERE invoice_id = $1', [invoiceId]);
        if (result.rows.length === 0) {
            return res.json({ status: null }); // No dispute
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching dispute status:', err);
        res.status(500).json({ error: err.message });
    }
};