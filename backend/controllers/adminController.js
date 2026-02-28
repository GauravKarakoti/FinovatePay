const { ethers } = require('ethers');
const { contractAddresses, getSigner, getFinancingManagerContract } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { logAudit } = require('../middleware/auditLogger');
const errorResponse = require('../utils/errorResponse');

// Helper: UUID → bytes32
const uuidToBytes32 = (uuid) => {
  const hex = '0x' + uuid.replace(/-/g, '');
  return ethers.zeroPadValue(hex, 32);
};

exports.checkCompliance = async (req, res) => {
  try {
    // Your compliance logic here
    res.json({ success: true, message: "Compliance checked" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ======================================================
   INVOICE CONFIG
====================================================== */
exports.setInvoiceSpread = async (req, res) => {
  if (req.user.role !== 'admin') {
    return errorResponse(res, 'Not authorized', 401);
  }

  const { tokenId, spreadBps } = req.body;
  if (!tokenId || spreadBps === undefined) {
    return errorResponse(res, 'Token ID and spreadBps are required', 400);
  }

  try {
    const financingContract = getFinancingManagerContract(true);
    const tx = await financingContract.setInvoiceSpread(tokenId, spreadBps);
    await tx.wait();

    res.json({ msg: 'Invoice spread updated successfully', tokenId, spreadBps });
  } catch (err) {
    console.error(err);
    return errorResponse(res, 'Server error', 500);
  }
};

/* ======================================================
   USER MANAGEMENT
====================================================== */
exports.getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, wallet_address, role, kyc_status, is_frozen FROM users ORDER BY created_at DESC'
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error(error);
    return errorResponse(res, error.message, 500);
  }
};

exports.freezeAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;

    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (!userResult.rows.length) throw new Error('User not found');
    if (userResult.rows[0].is_frozen) throw new Error('Account already frozen');

    const user = userResult.rows[0];

    await client.query('UPDATE users SET is_frozen = TRUE WHERE id = $1', [userId]);
    await client.query('COMMIT');

    await logAudit({
      operationType: 'ADMIN_FREEZE',
      entityType: 'USER',
      entityId: userId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'FREEZE_ACCOUNT',
      status: 'SUCCESS',
      oldValues: { is_frozen: false },
      newValues: { is_frozen: true },
      metadata: { target_user_email: user.email },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ success: true, message: 'Account frozen successfully' });
  } catch (error) {
    await client.query('ROLLBACK');

    await logAudit({
      operationType: 'ADMIN_FREEZE',
      entityType: 'USER',
      entityId: req.params.userId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'FREEZE_ACCOUNT',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};

exports.unfreezeAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;

    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (!userResult.rows.length) throw new Error('User not found');
    if (!userResult.rows[0].is_frozen) throw new Error('Account is not frozen');

    const user = userResult.rows[0];

    await client.query('UPDATE users SET is_frozen = FALSE WHERE id = $1', [userId]);
    await client.query('COMMIT');

    await logAudit({
      operationType: 'ADMIN_UNFREEZE',
      entityType: 'USER',
      entityId: userId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'UNFREEZE_ACCOUNT',
      status: 'SUCCESS',
      oldValues: { is_frozen: true },
      newValues: { is_frozen: false },
      metadata: { target_user_email: user.email },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ success: true, message: 'Account unfrozen successfully' });
  } catch (error) {
    await client.query('ROLLBACK');

    await logAudit({
      operationType: 'ADMIN_UNFREEZE',
      entityType: 'USER',
      entityId: req.params.userId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'UNFREEZE_ACCOUNT',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};

exports.updateUserRole = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.params;
    const { role } = req.body;

    const allowedRoles = ['admin', 'buyer', 'seller', 'shipment'];
    if (!allowedRoles.includes(role)) {
      return errorResponse(res, 'Invalid role specified', 400);
    }

    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT * FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );

    if (!userResult.rows.length) throw new Error('User not found');

    const user = userResult.rows[0];

    await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
    await client.query('COMMIT');

    await logAudit({
      operationType: 'ADMIN_ROLE_CHANGE',
      entityType: 'USER',
      entityId: userId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'UPDATE_ROLE',
      status: 'SUCCESS',
      oldValues: { role: user.role },
      newValues: { role },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ success: true, message: 'User role updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');

    await logAudit({
      operationType: 'ADMIN_ROLE_CHANGE',
      entityType: 'USER',
      entityId: req.params.userId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'UPDATE_ROLE',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};

/* ======================================================
   INVOICES
====================================================== */
exports.getInvoices = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error(error);
    return errorResponse(res, error.message, 500);
  }
};

/* ======================================================
   DISPUTE RESOLUTION
====================================================== */
exports.resolveDispute = async (req, res) => {
  const client = await pool.connect();
  try {
    const { invoiceId, sellerWins } = req.body;

    await client.query('BEGIN');

    const invoiceResult = await client.query(
      'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
      [invoiceId]
    );

    if (!invoiceResult.rows.length) throw new Error('Invoice not found');
    if (invoiceResult.rows[0].escrow_status !== 'disputed') {
      throw new Error('Invoice not disputed');
    }

    const escrow = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      getSigner()
    );

    const tx = await escrow.resolveDispute(uuidToBytes32(invoiceId), sellerWins);
    await tx.wait();

    const status = sellerWins ? 'resolved_seller_wins' : 'resolved_buyer_wins';

    await client.query(
      'UPDATE invoices SET escrow_status = $1, resolution_tx_hash = $2 WHERE invoice_id = $3',
      [status, tx.hash, invoiceId]
    );

    await client.query('COMMIT');

    await logAudit({
      operationType: 'ADMIN_RESOLVE_DISPUTE',
      entityType: 'INVOICE',
      entityId: invoiceId,
      actorId: req.user.id,
      actorWallet: req.user.wallet_address,
      actorRole: req.user.role,
      action: 'RESOLVE_DISPUTE',
      status: 'SUCCESS',
      metadata: { seller_wins: sellerWins, tx_hash: tx.hash },
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    res.json({ success: true, txHash: tx.hash });
  } catch (error) {
    await client.query('ROLLBACK');

    await logAudit({
      operationType: 'ADMIN_RESOLVE_DISPUTE',
      entityType: 'INVOICE',
      entityId: req.body?.invoiceId,
      actorId: req.user?.id,
      actorWallet: req.user?.wallet_address,
      actorRole: req.user?.role,
      action: 'RESOLVE_DISPUTE',
      status: 'FAILED',
      errorMessage: error.message,
      ipAddress: req.ip,
      userAgent: req.get('user-agent')
    });

    return errorResponse(res, error.message, 500);
  } finally {
    client.release();
  }
};