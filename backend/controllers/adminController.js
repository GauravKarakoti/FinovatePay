const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { getFinancingManagerContract } = require('../config/blockchain');
const { logAudit } = require('../middleware/auditLogger');

// Helper function to convert UUID to bytes32
const uuidToBytes32 = (uuid) => {
  // 1. Remove hyphens and prepend '0x'
  const hex = '0x' + uuid.replace(/-/g, '');
  // 2. Pad to 32 bytes
  return ethers.zeroPadValue(hex, 32);
};

exports.setInvoiceSpread = async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(401).json({ msg: 'Not authorized' });
  }

  const { tokenId, spreadBps } = req.body;

  if (!tokenId || !spreadBps) {
    return res.status(400).json({ msg: 'Token ID and spreadBps are required' });
  }

  try {
    // Get contract with admin signer
    const financingContract = getFinancingManagerContract(true); 
    
    const tx = await financingContract.setInvoiceSpread(tokenId, spreadBps);
    await tx.wait();

    res.json({ msg: 'Invoice spread updated successfully', tokenId, spreadBps });
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server error');
  }
};

// --- USER MANAGEMENT ---
exports.getAllUsers = async (req, res) => {
    console.log("getAllUsers called");
    try {
        const result = await pool.query('SELECT id, email, wallet_address, role, kyc_status, is_frozen FROM users ORDER BY created_at DESC');
        console.log("Users fetched:", result.rows);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Error in getAllUsers:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.freezeAccount = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { userId } = req.params;
        
        await client.query('BEGIN');
        
        // Get user details before freeze
        const userResult = await client.query(
            'SELECT * FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = userResult.rows[0];
        
        if (user.is_frozen) {
            throw new Error('Account is already frozen');
        }
        
        await client.query('UPDATE users SET is_frozen = TRUE WHERE id = $1', [userId]);
        
        await client.query('COMMIT');
        
        // Log audit entry
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
            metadata: { target_user_email: user.email, target_user_wallet: user.wallet_address },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.json({ success: true, message: 'Account frozen successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in freezeAccount:", error);
        
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
        
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.unfreezeAccount = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { userId } = req.params;
        
        await client.query('BEGIN');
        
        // Get user details before unfreeze
        const userResult = await client.query(
            'SELECT * FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = userResult.rows[0];
        
        if (!user.is_frozen) {
            throw new Error('Account is not frozen');
        }
        
        await client.query('UPDATE users SET is_frozen = FALSE WHERE id = $1', [userId]);
        
        await client.query('COMMIT');
        
        // Log audit entry
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
            metadata: { target_user_email: user.email, target_user_wallet: user.wallet_address },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.json({ success: true, message: 'Account unfrozen successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in unfreezeAccount:", error);
        
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
        
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

exports.updateUserRole = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { userId } = req.params;
        const { role } = req.body;

        // Add validation for allowed roles
        const allowedRoles = ['admin', 'buyer', 'seller', 'shipment'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role specified' });
        }

        await client.query('BEGIN');
        
        // Get user details before role change
        const userResult = await client.query(
            'SELECT * FROM users WHERE id = $1 FOR UPDATE',
            [userId]
        );
        
        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }
        
        const user = userResult.rows[0];
        const oldRole = user.role;
        
        await client.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
        
        await client.query('COMMIT');
        
        // Log audit entry
        await logAudit({
            operationType: 'ADMIN_ROLE_CHANGE',
            entityType: 'USER',
            entityId: userId,
            actorId: req.user.id,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'UPDATE_ROLE',
            status: 'SUCCESS',
            oldValues: { role: oldRole },
            newValues: { role },
            metadata: { target_user_email: user.email, target_user_wallet: user.wallet_address },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.json({ success: true, message: 'User role updated successfully' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in updateUserRole:", error);
        
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
            metadata: { requested_role: req.body.role },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};

// --- INVOICE MANAGEMENT ---
exports.getInvoices = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error("Error in getInvoices:", error);
        res.status(500).json({ error: error.message });
    }
};


// --- COMPLIANCE ---
exports.checkCompliance = async (req, res) => {
    try {
        const { walletAddress } = req.body;
        // Your compliance check logic here
        // This is a placeholder, you'll need to implement the actual check
        const isCompliant = !walletAddress.includes('bad'); // Example logic
        res.json({
            success: true,
            data: {
                compliant: isCompliant,
                reason: isCompliant ? '' : 'Address is on a denylist.'
            }
        });
    } catch (error) {
        console.error("Error in checkCompliance:", error);
        res.status(500).json({ error: error.message });
    }
};


// --- DISPUTE RESOLUTION ---
exports.resolveDispute = async (req, res) => {
    const client = await pool.connect();
    
    try {
        const { invoiceId, sellerWins } = req.body;
        
        await client.query('BEGIN');
        
        // Get invoice details before resolution
        const invoiceResult = await client.query(
            'SELECT * FROM invoices WHERE invoice_id = $1 FOR UPDATE',
            [invoiceId]
        );
        
        if (invoiceResult.rows.length === 0) {
            throw new Error('Invoice not found');
        }
        
        const invoice = invoiceResult.rows[0];
        
        if (invoice.escrow_status !== 'disputed') {
            throw new Error('Invoice is not in disputed status');
        }
        
        const signer = getSigner();
        const escrowContract = new ethers.Contract(
            contractAddresses.escrowContract,
            EscrowContractArtifact.abi,
            signer
        );
        console.log("Escrow contract instance created:", escrowContract.target);

        const bytes32InvoiceId = uuidToBytes32(invoiceId);

        const tx = await escrowContract.resolveDispute(bytes32InvoiceId, sellerWins);
        console.log(`Transaction sent to resolve dispute for invoice ${invoiceId}. Waiting for confirmation...`);
        await tx.wait();
        console.log(`Dispute for invoice ${invoiceId} resolved. Transaction hash: ${tx.hash}`);

        const resolutionStatus = sellerWins ? 'resolved_seller_wins' : 'resolved_buyer_wins';

        await client.query(
            'UPDATE invoices SET escrow_status = $1, resolution_tx_hash = $2 WHERE invoice_id = $3',
            [resolutionStatus, tx.hash, invoiceId]
        );
        
        await client.query('COMMIT');
        
        // Log audit entry
        await logAudit({
            operationType: 'ADMIN_RESOLVE_DISPUTE',
            entityType: 'INVOICE',
            entityId: invoiceId,
            actorId: req.user.id,
            actorWallet: req.user.wallet_address,
            actorRole: req.user.role,
            action: 'RESOLVE_DISPUTE',
            status: 'SUCCESS',
            oldValues: { escrow_status: 'disputed' },
            newValues: { escrow_status: resolutionStatus, tx_hash: tx.hash },
            metadata: { 
                seller_wins: sellerWins, 
                blockchain_tx: tx.hash,
                dispute_reason: invoice.dispute_reason
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in resolveDispute:", error);
        
        await logAudit({
            operationType: 'ADMIN_RESOLVE_DISPUTE',
            entityType: 'INVOICE',
            entityId: req.body.invoiceId,
            actorId: req.user?.id,
            actorWallet: req.user?.wallet_address,
            actorRole: req.user?.role,
            action: 'RESOLVE_DISPUTE',
            status: 'FAILED',
            errorMessage: error.message,
            metadata: { seller_wins: req.body.sellerWins },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.status(500).json({ error: error.message });
    } finally {
        client.release();
    }
};