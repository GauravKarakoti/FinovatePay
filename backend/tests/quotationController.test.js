const request = require('supertest');
const express = require('express');

// Mock the database pool
const mockPool = {
  query: jest.fn()
};

// Mock the marketService
const mockMarketService = {
  getPricePerKg: jest.fn()
};

// Mock dependencies before requiring the controller
jest.mock('../config/database', () => ({
  pool: mockPool
}));

jest.mock('../services/marketService', () => mockMarketService);

// Import the controller after mocking
const quotationController = require('../controllers/quotationController');

describe('Quotation Controller Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    role: 'buyer'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create a mock authenticateToken middleware
    const mockAuthenticateToken = jest.fn((req, res, next) => {
      req.user = mockUser;
      next();
    });

    // Create Express app
    app = express();
    app.use(express.json());
    
    // Mock auth middleware
    app.use((req, res, next) => {
      req.user = mockUser;
      next();
    });

    // Wrap controller functions with asyncHandler-like behavior
    app.post('/quotations', async (req, res) => {
      try {
        await quotationController.createQuotation(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/quotations', async (req, res) => {
      try {
        await quotationController.getQuotations(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.get('/quotations/pending-approval', async (req, res) => {
      try {
        await quotationController.getPendingBuyerApprovals(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.put('/quotations/:id/seller-approve', async (req, res) => {
      try {
        await quotationController.sellerApproveQuotation(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.put('/quotations/:id/buyer-approve', async (req, res) => {
      try {
        await quotationController.buyerApproveQuotation(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });

    app.put('/quotations/:id/reject', async (req, res) => {
      try {
        await quotationController.rejectQuotation(req, res);
      } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
      }
    });
  });

  describe('createQuotation', () => {
    const validQuotationData = {
      lotId: 'lot-123',
      sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
      buyerAddress: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
      quantity: 100,
      pricePerUnit: 50,
      description: 'Test quotation'
    };

    it('should create quotation for on-platform produce with lotId', async () => {
      // Mock: lot exists with sufficient quantity
      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ lot_id: 'lot-123', produce_type: 'wheat', current_quantity: 500 }] 
        });

      mockMarketService.getPricePerKg.mockResolvedValue(25);

      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ lot_id: 'lot-123', produce_type: 'wheat', current_quantity: 500 }] 
        })
        .mockResolvedValueOnce({ 
          rows: [{
            id: 1,
            lot_id: 'lot-123',
            seller_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
            buyer_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
            quantity: 100,
            price_per_unit: 25,
            total_amount: 2500,
            status: 'pending_seller_approval'
          }]
        });

      const response = await request(app)
        .post('/quotations')
        .send(validQuotationData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should reject when lotId is provided but sellerAddress is missing', async () => {
      const invalidData = {
        lotId: 'lot-123',
        buyerAddress: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        quantity: 100
      };

      const response = await request(app)
        .post('/quotations')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Seller address is required');
    });

    it('should reject when quantity exceeds available stock', async () => {
      mockPool.query
        .mockResolvedValueOnce({ 
          rows: [{ lot_id: 'lot-123', produce_type: 'wheat', current_quantity: 50 }] 
        });

      const response = await request(app)
        .post('/quotations')
        .send({ ...validQuotationData, quantity: 100 });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('exceeds available stock');
    });

    it('should reject when lot does not exist', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .post('/quotations')
        .send(validQuotationData);

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });

    it('should create off-platform quotation without lotId', async () => {
      const offPlatformData = {
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        buyerAddress: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        quantity: 100,
        pricePerUnit: 50,
        description: 'Off-platform quotation'
      };

      mockPool.query.mockResolvedValueOnce({ 
        rows: [{
          id: 2,
          seller_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
          buyer_address: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
          quantity: 100,
          price_per_unit: 50,
          total_amount: 5000,
          status: 'pending_buyer_approval'
        }]
      });

      const response = await request(app)
        .post('/quotations')
        .send(offPlatformData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject off-platform quotation without buyerAddress', async () => {
      const invalidData = {
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        quantity: 100,
        pricePerUnit: 50
      };

      const response = await request(app)
        .post('/quotations')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Buyer address is required');
    });

    it('should reject off-platform quotation without pricePerUnit', async () => {
      const invalidData = {
        sellerAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        buyerAddress: '0x123d35Cc6634C0532925a3b844Bc9e7595f0fE00',
        quantity: 100
      };

      const response = await request(app)
        .post('/quotations')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Price must be specified');
    });
  });

  describe('getQuotations', () => {
    it('should return quotations for user', async () => {
      const mockQuotations = [
        { id: 1, seller_address: mockUser.wallet_address, buyer_address: '0x123', quantity: 100 },
        { id: 2, seller_address: '0x456', buyer_address: mockUser.wallet_address, quantity: 200 }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockQuotations });

      const response = await request(app)
        .get('/quotations');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockQuotations);
    });

    it('should return empty array when no quotations exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/quotations');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual([]);
    });
  });

  describe('sellerApproveQuotation', () => {
    it('should approve quotation as seller', async () => {
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ id: 1, status: 'pending_seller_approval' }] 
      });

      const response = await request(app)
        .put('/quotations/1/seller-approve');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when quotation not found or unauthorized', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/quotations/999/seller-approve');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('buyerApproveQuotation', () => {
    it('should approve quotation as buyer', async () => {
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ id: 1, status: 'pending_buyer_approval' }] 
      });

      const response = await request(app)
        .put('/quotations/1/buyer-approve');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when quotation not found or unauthorized', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/quotations/999/buyer-approve');

      expect(response.status).toBe(404);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('rejectQuotation', () => {
    it('should reject quotation', async () => {
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ id: 1, status: 'pending_buyer_approval' }] 
      });

      const response = await request(app)
        .put('/quotations/1/reject');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when quotation not found or unauthorized', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .put('/quotations/999/reject');

      expect(response.status).toBe(404);
    });
  });

  describe('getPendingBuyerApprovals', () => {
    it('should return pending approvals for buyer', async () => {
      const mockApprovals = [
        { id: 1, status: 'pending_buyer_approval', produce_type: 'wheat' }
      ];

      mockPool.query.mockResolvedValueOnce({ rows: mockApprovals });

      const response = await request(app)
        .get('/quotations/pending-approval');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockApprovals);
    });

    it('should return empty array when no pending approvals', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const response = await request(app)
        .get('/quotations/pending-approval');

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });
});
