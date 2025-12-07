const axios = require('axios');

class SandboxService {
  constructor() {
    this.baseUrl = process.env.SANDBOX_BASE_URL || 'https://test-api.sandbox.co.in';
    this.apiKey = process.env.SANDBOX_API_KEY;
    this.apiSecret = process.env.SANDBOX_API_SECRET;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    // Return cached token if valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(`${this.baseUrl}/authenticate`, {}, {
        headers: {
          'x-api-key': this.apiKey,
          'x-api-secret': this.apiSecret,
          'x-api-version': '1.0'
        }
      });

      this.accessToken = response.data.data.access_token;
      // Token is valid for 24 hours, set expiry to 23 hours to be safe
      this.tokenExpiry = Date.now() + (23 * 60 * 60 * 1000);
      return this.accessToken;
    } catch (error) {
      console.error('Sandbox Auth Error:', error.response?.data || error.message);
      throw new Error('Failed to authenticate with KYC provider');
    }
  }

  async generateAadhaarOTP(aadhaarNumber) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.post(
        `${this.baseUrl}/kyc/aadhaar/okyc/otp`,
        {
          "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
          "aadhaar_number": aadhaarNumber,
          "consent": "y",
          "reason": "For KYC Verification"
        },
        {
          headers: {
            'Authorization': token,
            'x-api-key': this.apiKey,
            'x-api-version': '1.0'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Aadhaar OTP Gen Error:', error.response?.data || error.message);
      throw error;
    }
  }

  async verifyAadhaarOTP(referenceId, otp) {
    const token = await this.getAccessToken();
    try {
      const response = await axios.post(
        `${this.baseUrl}/kyc/aadhaar/okyc/otp/verify`,
        {
          "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
          "reference_id": String(referenceId), // CHANGED: Convert to String
          "otp": String(otp)                   // CHANGED: Ensure OTP is String
        },
        {
          headers: {
            'Authorization': token,
            'x-api-key': this.apiKey,
            'x-api-version': '1.0'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Aadhaar OTP Verify Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = new SandboxService();