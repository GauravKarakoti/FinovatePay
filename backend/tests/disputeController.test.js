const request = require('supertest');
const express = require('express');

// Mock the database pool
const mockPool = {
  query: jest.fn(),
  connect: jest.fn()
};

// Mock client for transaction
const mockClient = {
  query: jest.fn(),
  release: jest.fn()
};

mockPool.connect.mockResolvedValue(mockClient);

// Mock dependencies before requiring the controller
jest.mock('../config/database', () => ({
  pool: mockPool
}));

// Import the controller after mocking
const disputeController = require('../controllers/disputeController');

describe('Dispute Controller Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    role: 'buyer'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create Express app with mock IO
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = mockUser;
      req.app = { get: jest.fn().mockReturnValue(null) }; // Mock IO
      next();
    });

    // Set up routes
    app.post('/disputes/:invoiceId', async (req, res) => {
      try {
        await disputeController.raiseDispute(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/disputes/:invoiceId/evidence', async (req, res) => {
      try {
        await disputeController.uploadEvidence(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/disputes/:invoiceId/evidence', async (req, res) => {
      try {
        await disputeController.getEvidence(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/disputes/:invoiceId/logs', async (req, res) => {
      try {
        await disputeController.getLogs(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/disputes/:invoiceId/status', async (req, res) => {
      try {
        await disputeController.getDisputeStatus(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.put('/disputes/:invoiceId/resolve', async (req, res) => {
      try {
        await disputeController.resolveDispute(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  });

  describe('raiseDispute', () => {
    it('should raise a dispute successfully', async () => {
      // Mock: no existing dispute
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // check existing dispute
        .mockResolvedValueOnce({}) // INSERT dispute
        .mockResolvedValueOnce({}) // INSERT log
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/disputes/invoice-123')
        .send({ reason: 'Product not delivered' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when dispute already exists', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // existing dispute
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/disputes/invoice-123')
        .send({ reason: 'Product not delivered' });

      expect(response.status).toBe(500);
      expect(response.body.error).toContain('already exists');
    });

    it('should handle database errors', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Database error')); // check

      const response = await request(app)
        .post('/disputes/invoice-123')
        .send({ reason: 'Test' });

      expect(response.status).toBe(500);
    });
  });

  describe('uploadEvidence', () => {
    it('should upload evidence successfully', async () => {
      // Mock file
      const mockFile = {
        filename: 'evidence-123.pdf',
        originalname: 'evidence.pdf'
      };

      // Mock: dispute exists
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // dispute exists
        .mockResolvedValueOnce({}) // INSERT evidence
        .mockResolvedValueOnce({}) // INSERT log
        .mockResolvedValueOnce({}); // COMMIT

      // Override req.file for this test
      const uploadApp = express();
      uploadApp.use(express.json());
      uploadApp.use((req, res, next) => {
        req.user = mockUser;
        req.app = { get: jest.fn().mockReturnValue(null) };
        req.file = mockFile;
        next();
      });

      uploadApp.post('/disputes/:invoiceId/evidence', async (req, res) => {
        try {
          await disputeController.uploadEvidence(req, res);
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      const response = await request(uploadApp)
        .post('/disputes/invoice-123/evidence');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when no file uploaded', async () => {
      const noFileApp = express();
      noFileApp.use(express.json());
      noFileApp.use((req, res, next) => {
        req.user = mockUser;
        req.app = { get: jest.fn().mockReturnValue(null) };
        req.file = undefined;
        next();
      });

      noFileApp.post('/disputes/:invoiceId/evidence', async (req, res) => {
        try {
          await disputeController.uploadEvidence(req, res);
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      const response = await request(noFileApp)
        .post('/disputes/invoice-123/evidence');

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('No file');
    });

    it('should auto-create dispute if not exists and upload evidence', async () => {
      const mockFile = {
        filename: 'evidence-123.pdf',
        originalname: 'evidence.pdf'
      };

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // no dispute exists
        .mockResolvedValueOnce({}) // INSERT dispute (auto-created)
        .mockResolvedValueOnce({}) // INSERT log
        .mockResolvedValueOnce({}) // INSERT evidence
        .mockResolvedValueOnce({}) // INSERT log
        .mockResolvedValueOnce({}); // COMMIT

      const autoCreateApp = express();
      autoCreateApp.use(express.json());
      autoCreateApp.use((req, res, next) => {
        req.user = mockUser;
        req.app = { get: jest.fn().mockReturnValue(null) };
        req.file = mockFile;
        next();
      });

      autoCreateApp.post('/disputes/:invoiceId/evidence', async (req, res) => {
        try {
          await disputeController.uploadEvidence(req, res);
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      const response = await request(autoCreateApp)
        .post('/disputes/invoice-123/evidence');

      expect(response.status).toBe(200);
    });
  });

  describe('getEvidence', () => {
    it('should return evidence for invoice', async () => {
      const mockEvidence = [
        { id: 1, file_url: '/uploads/evidence1.pdf', file_name: 'evidence1.pdf' },
        { id: 2, file_url: '/uploads/evidence2.pdf', file_name: 'evidence2.pdf' }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockEvidence });

      const response = await request(app)
        .get('/disputes/invoice-123/evidence');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockEvidence);
    });

    it('should return empty array when no evidence', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/disputes/invoice-123/evidence');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/disputes/invoice-123/evidence');

      expect(response.status).toBe(500);
    });
  });

  describe('getLogs', () => {
    it('should return logs for invoice', async () => {
      const mockLogs = [
        { action: 'Dispute Raised', performed_by: 'test@example.com', notes: 'Test reason' },
        { action: 'Evidence Uploaded', performed_by: 'test@example.com', notes: 'Uploaded file.pdf' }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockLogs });

      const response = await request(app)
        .get('/disputes/invoice-123/logs');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockLogs);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/disputes/invoice-123/logs');

      expect(response.status).toBe(500);
    });
  });

  describe('getDisputeStatus', () => {
    it('should return dispute status', async () => {
      const mockDispute = { id: 1, status: 'open', resolution_note: 'Test reason' };

      mockPool.query.mockResolvedValueOnce({ rows: [mockDispute] });

      const response = await request(app)
        .get('/disputes/invoice-123/status');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockDispute);
    });

    it('should return null status when no dispute', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/disputes/invoice-123/status');

      expect(response.status).toBe(200);
      expect(response.body.status).toBeNull();
    });
  });

  describe('resolveDispute', () => {
    const arbitratorUser = { ...mockUser, role: 'arbitrator' };

    it('should resolve dispute as arbitrator', async () => {
      const resolveApp = express();
      resolveApp.use(express.json());
      resolveApp.use((req, res, next) => {
        req.user = arbitratorUser;
        req.app = { get: jest.fn().mockReturnValue(null) };
        next();
      });

      resolveApp.put('/disputes/:invoiceId/resolve', async (req, res) => {
        try {
          await disputeController.resolveDispute(req, res);
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // UPDATE
        .mockResolvedValueOnce({}) // INSERT log
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(resolveApp)
        .put('/disputes/invoice-123/resolve')
        .send({ status: 'resolved', notes: 'Resolved in favor of buyer' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject non-arbitrator from resolving', async () => {
      const response = await request(app)
        .put('/disputes/invoice-123/resolve')
        .send({ status: 'resolved', notes: 'Test' });

      expect(response.status).toBe(403);
      expect(response.body.error).toContain('arbitrator');
    });

    it('should handle database errors', async () => {
      const errorApp = express();
      errorApp.use(express.json());
      errorApp.use((req, res, next) => {
        req.user = arbitratorUser;
        req.app = { get: jest.fn().mockReturnValue(null) };
        next();
      });

      errorApp.put('/disputes/:invoiceId/resolve', async (req, res) => {
        try {
          await disputeController.resolveDispute(req, res);
        } catch (err) {
          res.status(err.status || 500).json({ error: err.message });
        }
      });

      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Database error'));

      const response = await request(errorApp)
        .put('/disputes/invoice-123/resolve')
        .send({ status: 'resolved', notes: 'Test' });

      expect(response.status).toBe(500);
    });
  });
});
