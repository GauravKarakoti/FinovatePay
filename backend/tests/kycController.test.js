const request = require('supertest');
const express = require('express');

// Mock the database pool
const mockPool = {
  query: jest.fn()
};

// Mock the sandboxService
const mockSandboxService = {
  generateAadhaarOTP: jest.fn(),
  verifyAadhaarOTP: jest.fn()
};

// Mock kycService
const mockKycService = {
  upsertWalletMapping: jest.fn(),
  getWalletStatus: jest.fn(),
  syncWithBlockchain: jest.fn()
};

// Mock getSigner
const mockGetSigner = jest.fn();

// Mock config
jest.mock('../config/database', () => ({
  pool: mockPool
}));

jest.mock('../services/sandboxService', () => mockSandboxService);
jest.mock('../services/kycService', () => mockKycService);
jest.mock('../config/blockchain', () => ({
  getSigner: mockGetSigner,
  contractAddresses: {
    complianceManager: '0x1234567890123456789012345678901234567890'
  }
}));

// Import the controller after mocking
const kycController = require('../controllers/kycController');

describe('KYC Controller Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    role: 'buyer'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = mockUser;
      req.app = { get: jest.fn().mockReturnValue(null) };
      next();
    });

    // Set up routes
    app.post('/kyc/wallet/verify', async (req, res) => {
      try {
        await kycController.verifyWallet(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/kyc/wallet/status', async (req, res) => {
      try {
        await kycController.getWalletStatus(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/kyc/initiate', async (req, res) => {
      try {
        await kycController.initiateKYC(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/kyc/verify-otp', async (req, res) => {
      try {
        await kycController.verifyKYCOtp(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/kyc/check-compliance', async (req, res) => {
      try {
        await kycController.checkCompliance(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  });

  describe('verifyWallet', () => {
    it('should verify wallet successfully', async () => {
      mockKycService.upsertWalletMapping.mockResolvedValue();

      const response = await request(app)
        .post('/kyc/wallet/verify')
        .send({ walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockKycService.upsertWalletMapping).toHaveBeenCalled();
    });

    it('should reject when walletAddress is missing', async () => {
      const response = await request(app)
        .post('/kyc/wallet/verify')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('should handle database errors', async () => {
      mockKycService.upsertWalletMapping.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/kyc/wallet/verify')
        .send({ walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(500);
    });

    it('should include all provided parameters', async () => {
      mockKycService.upsertWalletMapping.mockResolvedValue();

      const response = await request(app)
        .post('/kyc/wallet/verify')
        .send({ 
          walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
          status: 'verified',
          riskLevel: 'low',
          provider: 'manual'
        });

      expect(response.status).toBe(200);
      expect(mockKycService.upsertWalletMapping).toHaveBeenCalledWith(
        expect.objectContaining({
          walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
          status: 'verified',
          riskLevel: 'low',
          provider: 'manual'
        })
      );
    });
  });

  describe('getWalletStatus', () => {
    it('should return wallet status', async () => {
      const mockStatus = { status: 'verified', riskLevel: 'low' };
      mockKycService.getWalletStatus.mockResolvedValue(mockStatus);

      const response = await request(app)
        .get('/kyc/wallet/status')
        .query({ wallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockStatus);
    });

    it('should reject when wallet address is missing', async () => {
      const response = await request(app)
        .get('/kyc/wallet/status');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('required');
    });

    it('should handle database errors', async () => {
      mockKycService.getWalletStatus.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/kyc/wallet/status')
        .query({ wallet: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(500);
    });
  });

  describe('initiateKYC', () => {
    it('should initiate KYC successfully', async () => {
      mockSandboxService.generateAadhaarOTP.mockResolvedValue({
        data: { reference_id: 'ref-123' }
      });
      mockPool.query.mockResolvedValue({});

      const response = await request(app)
        .post('/kyc/initiate')
        .send({ idNumber: '123456789012' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.referenceId).toBe('ref-123');
    });

    it('should handle sandbox service errors', async () => {
      mockSandboxService.generateAadhaarOTP.mockRejectedValue(
        new Error('Service unavailable')
      );

      const response = await request(app)
        .post('/kyc/initiate')
        .send({ idNumber: '123456789012' });

      expect(response.status).toBe(500);
    });
  });

  describe('verifyKYCOtp', () => {
    it('should verify OTP successfully', async () => {
      mockSandboxService.verifyAadhaarOTP.mockResolvedValue({
        code: 200,
        data: { name: 'John Doe', dob: '1990-01-01' }
      });
      
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' }] })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});

      const mockSigner = {
        verifyKYC: jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) })
      };
      mockGetSigner.mockReturnValue(mockSigner);

      const response = await request(app)
        .post('/kyc/verify-otp')
        .send({ otp: '123456', referenceId: 'ref-123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when user wallet not found', async () => {
      mockSandboxService.verifyAadhaarOTP.mockResolvedValue({
        code: 200,
        data: { name: 'John Doe' }
      });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/kyc/verify-otp')
        .send({ otp: '123456', referenceId: 'ref-123' });

      expect(response.status).toBe(500);
    });

    it('should handle invalid OTP', async () => {
      mockSandboxService.verifyAadhaarOTP.mockResolvedValue({
        code: 400,
        message: 'Invalid OTP'
      });

      const response = await request(app)
        .post('/kyc/verify-otp')
        .send({ otp: '000000', referenceId: 'ref-123' });

      expect(response.status).toBe(500);
    });
  });

  describe('checkCompliance', () => {
    it('should return compliant for verified user with low risk', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ kyc_status: 'verified', kyc_risk_level: 'low' }]
      });

      const response = await request(app)
        .post('/kyc/check-compliance')
        .send({ walletAddress:d35Cc663 '0x7424C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(200);
      expect(response.body.compliant).toBe(true);
      expect(response.body.reason).toBe('');
    });

    it('should return non-compliant for unverified user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ kyc_status: 'pending', kyc_risk_level: 'low' }]
      });

      const response = await request(app)
        .post('/kyc/check-compliance')
        .send({ walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(200);
      expect(response.body.compliant).toBe(false);
    });

    it('should return non-compliant for high risk user', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ kyc_status: 'verified', kyc_risk_level: 'high' }]
      });

      const response = await request(app)
        .post('/kyc/check-compliance')
        .send({ walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(200);
      expect(response.body.compliant).toBe(false);
    });

    it('should return non-compliant for unregistered user', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/kyc/check-compliance')
        .send({ walletAddress: '0x9999999999999999999999999999999999999999' });

      expect(response.status).toBe(200);
      expect(response.body.compliant).toBe(false);
      expect(response.body.reason).toContain('not registered');
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/kyc/check-compliance')
        .send({ walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(500);
    });
  });
});
