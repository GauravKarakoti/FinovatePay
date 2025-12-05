const pool = require('../config/database');
const axios = require('axios');

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