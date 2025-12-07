const pool = require('../config/database');
const axios = require('axios');
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
    
    await pool.query(
      `INSERT INTO kyc_verifications 
       (user_id, id_type, id_number, status, reference_id) 
       VALUES ($1, 'aadhaar', $2, 'pending_otp', $3)
       ON CONFLICT (user_id) DO UPDATE 
       SET reference_id = $3, status = 'pending_otp', id_number = $2`,
      [userId, idNumber, sandboxResponse.data.transaction_id] 
    );

    res.json({
      success: true,
      message: 'OTP sent to Aadhaar-linked mobile number',
      referenceId: sandboxResponse.data.transaction_id
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
        // Mark as verified off-chain but failed on-chain? Or fail completely?
        // Usually safer to fail or mark as "verified_offchain_only"
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

const verifyKYC = async (userData) => {
  // Using environment variables defined in .env.example
  const PROVIDER_URL = process.env.KYC_PROVIDER_URL;
  const API_KEY = process.env.KYC_API_KEY;

  if (!PROVIDER_URL || !API_KEY) {
      console.warn("KYC Configuration missing. Falling back to mock logic.");
      return { verified: false, riskLevel: 'unknown', details: 'KYC Configuration Missing' };
  }

  try {
    // Construct the payload required by your specific provider (e.g., Sumsub, Onfido)
    const payload = {
      externalUserId: userData.id,
      email: userData.email,
      firstName: userData.first_name, // Assuming these fields exist in your User model
      lastName: userData.last_name,
      dob: userData.date_of_birth,
      document: {
          // In a real flow, you might pass a document ID or image URL uploaded earlier
          type: userData.document_type, 
          number: userData.document_number
      }
    };

    const response = await axios.post(PROVIDER_URL, payload, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`, // Or 'X-API-KEY': API_KEY depending on provider
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 second timeout
    });
    
    // Parse response based on provider's specific schema
    // This example assumes a generic response structure
    const { status, riskScore, failureReason } = response.data;

    // Map provider status to our system's status
    const isVerified = status === 'APPROVED' || status === 'VERIFIED';
    
    // Map risk score to level
    let riskLevel = 'low';
    if (riskScore > 0.7) riskLevel = 'high';
    else if (riskScore > 0.3) riskLevel = 'medium';

    return {
      verified: isVerified,
      riskLevel: riskLevel,
      details: isVerified ? 'Verification Successful' : (failureReason || 'Verification declined by provider')
    };

  } catch (error) {
    console.error('KYC External API verification failed:', error.response?.data || error.message);
    
    // Differentiate between network error and rejection
    return { 
        verified: false, 
        riskLevel: 'high', 
        details: 'Provider Error: ' + (error.response?.data?.message || error.message) 
    };
  }
};

exports.verifyUser = async (req, res) => {
  try {
    const { userId } = req.body;
    const userResult = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    const user = userResult.rows[0];
    const kycResult = await verifyKYC(user);

    if (kycResult.verified && user.wallet_address) {
        try {
            const signer = getSigner();
            const complianceSBT = getComplianceSBTContract(signer);
            
            // Check if user already has identity to avoid revert
            const hasIdentity = await complianceSBT.hasIdentity(user.wallet_address);
            
            if (!hasIdentity) {
                console.log(`Minting SBT for ${user.wallet_address}...`);
                const tx = await complianceSBT.mintIdentity(user.wallet_address);
                await tx.wait();
                console.log(`SBT Minted: ${tx.hash}`);
            }
        } catch (chainError) {
            console.error("Blockchain Interaction Failed:", chainError);
            // Decide if you want to fail the whole request or just log it
        }
    }
    
    await pool.query(
      'UPDATE users SET kyc_status = $1, kyc_risk_level = $2, kyc_details = $3 WHERE id = $4',
      [kycResult.verified ? 'verified' : 'failed', kycResult.riskLevel, kycResult.details, userId]
    );
    
    res.json({
      success: true,
      verified: kycResult.verified,
      riskLevel: kycResult.riskLevel
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
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