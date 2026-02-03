const { pool } = require('../config/database');
const sandboxService = require('../services/sandboxService');
const { ethers } = require('ethers');
const { getSigner, contractAddresses } = require('../config/blockchain');
const ComplianceManagerArtifact = require('../../deployed/ComplianceManager.json');

exports.initiateKYC = async (req, res) => {
  const { idNumber } = req.body;
  const userId = req.user.id;

  try {
    // Call Sandbox to generate OTP
    const sandboxResponse = await sandboxService.generateAadhaarOTP(idNumber);
    console.log("Sandbox Response: ", sandboxResponse);

    // CHANGED: Use .data.reference_id instead of .transaction_id
    const kycReferenceId = sandboxResponse.data.reference_id; 

    console.log(userId, idNumber, kycReferenceId);
    
    await pool.query(
      `INSERT INTO kyc_verifications 
       (user_id, id_type, id_number, status, reference_id) 
       VALUES ($1, 'aadhaar', $2, 'pending_otp', $3)
       ON CONFLICT (user_id) DO UPDATE 
       SET reference_id = $3, status = 'pending_otp', id_number = $2`,
      [userId, idNumber, kycReferenceId] // Update this variable
    );

    res.json({
      success: true,
      message: 'OTP sent to Aadhaar-linked mobile number',
      referenceId: kycReferenceId // Update this variable
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.response?.data?.message || 'Failed to initiate KYC' 
    });
  }
};

exports.verifyKYCOtp = async (req, res) => {
  const { otp, referenceId } = req.body;
  const userId = req.user.id;

  try {
    // 1. Verify OTP with Sandbox
    const verifyResponse = await sandboxService.verifyAadhaarOTP(referenceId, otp);
    
    if (verifyResponse.code === 200) {
      const kycData = verifyResponse.data;
      const userResult = await pool.query('SELECT wallet_address FROM users WHERE id = $1', [userId]);
      const userWalletAddress = userResult.rows[0]?.wallet_address;

      if (!userWalletAddress) {
        throw new Error('User wallet address not found');
      }

      // 2. On-Chain Transaction (Mint SBT)
      try {
        const signer = getSigner();
        const complianceManager = new ethers.Contract(
            contractAddresses.complianceManager,
            ComplianceManagerArtifact.abi,
            signer
        );

        console.log(`Verifying on-chain for: ${userWalletAddress}`);
        const tx = await complianceManager.verifyKYC(userWalletAddress);
        await tx.wait();
        console.log(`On-chain KYC verified: ${tx.hash}`);

        // 3. Update Database
        await pool.query(
            `UPDATE kyc_verifications 
             SET status = 'verified', risk_level = 'low', verified_at = CURRENT_TIMESTAMP, 
                 details = $1 
             WHERE user_id = $2`,
            [JSON.stringify(kycData), userId]
        );

        await pool.query(
            `UPDATE users SET kyc_status = 'verified', kyc_risk_level = 'low' WHERE id = $1`,
            [userId]
        );

        res.json({
          success: true,
          message: 'KYC Verification Successful',
          data: kycData
        });

      } catch (chainError) {
        console.error('Blockchain Error:', chainError);
        throw new Error('KYC verified but Blockchain transaction failed. Please contact support.');
      }
    } else {
      throw new Error('OTP Verification failed');
    }
  } catch (error) {
    console.error('KYC Verification Error:', error);
    res.status(400).json({ 
      success: false, 
      error: error.response?.data?.message || error.message || 'Verification failed' 
    });
  }
};

exports.checkCompliance = async (req, res) => {
  try {
    const { walletAddress } = req.body;
    
    // Check if wallet is flagged
    const result = await pool.query(
      'SELECT kyc_status, kyc_risk_level FROM users WHERE wallet_address = $1',
      [walletAddress]
    );
    
    if (result.rows.length === 0) {
      return res.json({ compliant: false, reason: 'User not registered' });
    }
    
    const user = result.rows[0];
    const compliant = user.kyc_status === 'verified' && user.kyc_risk_level === 'low';
    
    res.json({
      compliant,
      reason: compliant ? '' : `KYC status: ${user.kyc_status}, Risk level: ${user.kyc_risk_level}`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};