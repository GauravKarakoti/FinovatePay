const request = require('supertest');
const express = require('express');

// Mock the database pool
const mockPool = {
  query: jest.fn()
};

// Mock ethers
const mockContract = {
  confirmRelease: jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) }),
  raiseDispute: jest.fn().mockResolvedValue({ wait: jest.fn().mockResolvedValue({}) })
};

const mockEthers = {
  Contract: jest.fn().mockImplementation(() => mockContract),
  zeroPadValue: jest.fn((hex, bytes) => hex)
};

// Mock getSigner
const mockGetSigner = jest.fn().mockReturnValue({});

// Mock config
jest.mock('../config/database', () => ({
  pool: mockPool
}));

jest.mock('ethers', () => mockEthers);
jest.mock('../config/blockchain', () => ({
  getSigner: mockGetSigner,
  contractAddresses: {
    escrowContract: '0x1234567890123456789012345678901234567890'
  }
}));

jest.mock('../../deployed/EscrowContract.json', () => ({ abi: [] }), { virtual: true });

// Import the controller after mocking
const escrowController = require('../controllers/escrowController');

describe('Escrow Controller Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    role: 'buyer'
  };

  // Mock IO
  const mockIO = {
    to: jest.fn().mockReturnValue({
      emit: jest.fn()
    })
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = mockUser;
      req.app = { get: jest.fn().mockReturnValue(mockIO) };
      next();
    });

    // Set up routes
    app.post('/escrow/release', async (req, res) => {
      try {
        await escrowController.releaseEscrow(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/escrow/dispute', async (req, res) => {
      try {
        await escrowController.raiseDispute(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  });

  describe('releaseEscrow', () => {
    it('should release escrow successfully', async () => {
      mockPool.query.mockResolvedValue({});

      const response = await request(app)
        .post('/escrow/release')
        .send({ invoiceId: 'invoice-123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.txHash).toBeDefined();
    });

    it('should reject when invoiceId is missing', async () => {
      const response = await request(app)
        .post('/escrow/release')
        .send({});

      expect(response.status).toBe(500);
    });

    it('should handle blockchain errors', async () => {
      mockContract.confirmRelease.mockRejectedValue(new Error('Blockchain error'));

      const response = await request(app)
        .post('/escrow/release')
        .send({ invoiceId: 'invoice-123' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should emit socket event on success', async () => {
      mockPool.query.mockResolvedValue({});

      await request(app)
        .post('/escrow/release')
        .send({ invoiceId: 'invoice-123' });

      expect(mockIO.to).toHaveBeenCalledWith('invoice-invoice-123');
    });
  });

  describe('raiseDispute (Escrow)', () => {
    it('should raise dispute successfully', async () => {
      mockPool.query.mockResolvedValue({});

      const response = await request(app)
        .post('/escrow/dispute')
        .send({ invoiceId: 'invoice-123', reason: 'Payment dispute' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when invoiceId is missing', async () => {
      const response = await request(app)
        .post('/escrow/dispute')
        .send({ reason: 'Payment dispute' });

      expect(response.status).toBe(500);
    });

    it('should reject when reason is missing', async () => {
      const response = await request(app)
        .post('/escrow/dispute')
        .send({ invoiceId: 'invoice-123' });

      expect(response.status).toBe(500);
    });

    it('should handle blockchain errors', async () => {
      mockContract.raiseDispute.mockRejectedValue(new Error('Blockchain error'));

      const response = await request(app)
        .post('/escrow/dispute')
        .send({ invoiceId: 'invoice-123', reason: 'Test dispute' });

      expect(response.status).toBe(500);
    });
  });
});
