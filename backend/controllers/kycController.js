const pool = require('../config/database');
const axios = require('axios');

// Mock KYC provider integration
const verifyKYC = async (userData) => {
  // In a real implementation, this would call a KYC provider API
  try {
    const response = await axios.post(process.env.KYC_PROVIDER_URL, {
      apiKey: process.env.KYC_API_KEY,
      userData: userData
    });
    
    return {
      verified: response.data.verified,
      riskLevel: response.data.riskLevel,
      details: response.data.details
    };
  } catch (error) {
    console.error('KYC verification failed:', error);
    return { verified: false, riskLevel: 'high', details: 'Verification failed' };
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