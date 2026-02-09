const { ethers } = require('ethers');
const { contractAddresses, getSigner } = require('../config/blockchain');
const { pool } = require('../config/database');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');
const { getFinancingManagerContract } = require('../config/blockchain');

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
    try {
        const { userId } = req.params; // FIX: Get userId from req.params
        await pool.query('UPDATE users SET is_frozen = TRUE WHERE id = $1', [userId]);
        res.json({ success: true, message: 'Account frozen successfully' });
    } catch (error) {
        console.error("Error in freezeAccount:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.unfreezeAccount = async (req, res) => {
    try {
        const { userId } = req.params; // FIX: Get userId from req.params
        await pool.query('UPDATE users SET is_frozen = FALSE WHERE id = $1', [userId]);
        res.json({ success: true, message: 'Account unfrozen successfully' });
    } catch (error) {
        console.error("Error in unfreezeAccount:", error);
        res.status(500).json({ error: error.message });
    }
};

exports.updateUserRole = async (req, res) => {
    try {
        const { userId } = req.params;
        const { role } = req.body;

        // Add validation for allowed roles
        const allowedRoles = ['admin', 'buyer', 'seller', 'shipment'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ error: 'Invalid role specified' });
        }

        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, userId]);
        res.json({ success: true, message: 'User role updated successfully' });
    } catch (error) {
        console.error("Error in updateUserRole:", error);
        res.status(500).json({ error: error.message });
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
    try {
        const { invoiceId, sellerWins } = req.body;
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

        await pool.query(
            'UPDATE invoices SET escrow_status = $1, resolution_tx_hash = $2 WHERE invoice_id = $3',
            [resolutionStatus, tx.hash, invoiceId]
        );

        res.json({ success: true, txHash: tx.hash });
    } catch (error) {
        console.error("Error in resolveDispute:", error);
        res.status(500).json({ error: error.message });
    }
};