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

// Mock config
jest.mock('../config/database', () => ({
  pool: mockPool
}));

// Import the controller after mocking
const invoiceController = require('../controllers/invoiceController');

describe('Invoice Controller Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    role: 'buyer',
    organization_id: 'org-123'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = mockUser;
      next();
    });

    // Set up routes
    app.post('/invoices', async (req, res) => {
      try {
        await invoiceController.createInvoice(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.post('/invoices/:invoiceId/settle-early', async (req, res) => {
      try {
        await invoiceController.settleInvoiceEarly(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/invoices/:invoiceId/early-payment-offer', async (req, res) => {
      try {
        await invoiceController.getEarlyPaymentOffer(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  });

  describe('createInvoice', () => {
    const validInvoiceData = {
      quotation_id: 1,
      invoice_id: 'INV-001',
      invoice_hash: '0xabc123',
      contract_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
      token_address: '0x4567890123456789012345678901234567890',
      due_date: '2024-12-31',
      tx_hash: '0xtx123'
    };

    it('should create invoice successfully', async () => {
      // Mock quotation query
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 1, 
            seller_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
            buyer_address: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
            quantity: 100,
            total_amount: 5000,
            description: 'Test invoice',
            currency: 'USD',
            lot_id: null,
            seller_org_id: 'org-123'
          }] 
        }) // SELECT quotation
        .mockResolvedValueOnce({}) // UPDATE produce_lots
        .mockResolvedValueOnce({}) // UPDATE quotations
        .mockResolvedValueOnce({}) // INSERT invoice
        .mockResolvedValueOnce({}) // UPDATE quotations
        .mockResolvedValueOnce({}); // COMMIT

      const response = await request(app)
        .post('/invoices')
        .send(validInvoiceData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject when quotation_id is missing', async () => {
      const response = await request(app)
        .post('/invoices')
        .send({ invoice_id: 'INV-001', contract_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing');
    });

    it('should reject when invoice_id is missing', async () => {
      const response = await request(app)
        .post('/invoices')
        .send({ quotation_id: 1, contract_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.status).toBe(400);
    });

    it('should reject when contract_address is missing', async () => {
      const response = await request(app)
        .post('/invoices')
        .send({ quotation_id: 1, invoice_id: 'INV-001' });

      expect(response.status).toBe(400);
    });

    it('should reject when quotation not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT quotation - not found
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/invoices')
        .send(validInvoiceData);

      expect(response.status).toBe(500);
    });

    it('should reject when not authorized for quotation', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ 
          rows: [{ 
            id: 1, 
            seller_address: '0x999d35Cc6634C0532925a3b844Bc9e7595f0fE00',
            seller_org_id: 'different-org'
          }] 
        })
        .mockResolvedValueOnce({}); // ROLLBACK

      const response = await request(app)
        .post('/invoices')
        .send(validInvoiceData);

      expect(response.status).toBe(500);
    });
  });

  describe('settleInvoiceEarly', () => {
    it('should settle invoice early successfully', async () => {
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ invoice_id: 'INV-001', status: 'pending' }] 
      });

      const response = await request(app)
        .post('/invoices/INV-001/settle-early');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 when invoice not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/invoices/INV-999/settle-early');

      expect(response.status).toBe(404);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .post('/invoices/INV-001/settle-early');

      expect(response.status).toBe(500);
    });
  });

  describe('getEarlyPaymentOffer', () => {
    it('should return early payment offer for eligible invoice', async () => {
      // Set a future date for due_date (30 days from now)
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ 
          amount: 5000, 
          annual_apr: 18, 
          due_date: futureDate.toISOString() 
        }] 
      });

      const response = await request(app)
        .get('/invoices/INV-001/early-payment-offer');

      expect(response.status).toBe(200);
      expect(response.body.eligible).toBe(true);
      expect(response.body.originalAmount).toBe(5000);
      expect(response.body.discountAmount).toBeDefined();
      expect(response.body.offerAmount).toBeDefined();
    });

    it('should return not eligible for overdue invoice', async () => {
      // Set a past date for due_date
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);
      
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ 
          amount: 5000, 
          annual_apr: 18, 
          due_date: pastDate.toISOString() 
        }] 
      });

      const response = await request(app)
        .get('/invoices/INV-001/early-payment-offer');

      expect(response.status).toBe(200);
      expect(response.body.eligible).toBe(false);
      expect(response.body.message).toContain('due or overdue');
    });

    it('should return 404 when invoice not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/invoices/INV-999/early-payment-offer');

      expect(response.status).toBe(404);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      const response = await request(app)
        .get('/invoices/INV-001/early-payment-offer');

      expect(response.status).toBe(500);
    });

    it('should handle null APR with default value', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 30);
      
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ 
          amount: 5000, 
          annual_apr: null, 
          due_date: futureDate.toISOString() 
        }] 
      });

      const response = await request(app)
        .get('/invoices/INV-001/early-payment-offer');

      expect(response.status).toBe(200);
      expect(response.body.eligible).toBe(true);
      // Should use default APR of 18%
      expect(response.body.apr).toBe('18.00');
    });
  });
});
