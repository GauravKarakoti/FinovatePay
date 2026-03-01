const request = require('supertest');
const express = require('express');
const { body, validationResult } = require('express-validator');

// MOCK DEPENDENCIES
// 1. Mock Auth Middleware to bypass token check but keep requireRole real
jest.mock('../middleware/auth', () => {
  const original = jest.requireActual('../middleware/auth');
  return {
    ...original,
    authenticateToken: (req, res, next) => next(), // Pass through
  };
});

// 2. Mock Controllers to avoid DB/Blockchain calls
jest.mock('../controllers/kycController', () => ({
  verifyWallet: jest.fn((req, res) => res.status(200).json({ success: true, message: 'Mock Verify Success' })),
  initiateKYC: jest.fn(),
  verifyKYCOtp: jest.fn(),
  getWalletStatus: jest.fn()
}));

jest.mock('../controllers/invoiceController', () => ({
  createInvoice: jest.fn((req, res) => res.status(201).json({ success: true, message: 'Mock Invoice Created' })),
  getEarlyPaymentOffer: jest.fn(),
  settleInvoiceEarly: jest.fn()
}));

// 3. Mock Models and Services used in routes
jest.mock('../models/Invoice', () => ({
  findBySeller: jest.fn(),
  findByBuyer: jest.fn(),
  findById: jest.fn(),
}));

jest.mock('../services/escrowSyncService', () => ({
  syncInvoiceStatus: jest.fn()
}));

// Mock KYC Validation Middleware to bypass DB check
jest.mock('../middleware/kycValidation', () => ({
  requireKYC: (req, res, next) => next()
}));

// 4. Mock Database (for any inline queries in routes, if any)
jest.mock('../config/database', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] })
  }
}));

describe('Security Fix Verification', () => {
  let app;

  // Routes are required inside the test to ensure mocks are applied
  let kycRoutes;
  let invoiceRoutes;

  beforeEach(() => {
    jest.clearAllMocks();

    // Re-require routes to ensure clean state if needed (though require cache persists, mocks handle it)
    kycRoutes = require('../routes/kyc');
    invoiceRoutes = require('../routes/invoice');

    app = express();
    app.use(express.json());

    // Middleware to inject user with specific role
    app.use((req, res, next) => {
      // Default to admin, overridden by headers in tests
      const role = req.headers['x-test-role'] || 'admin';
      req.user = {
        id: 1,
        wallet_address: '0xadmin',
        role: role,
        organization_id: 1 // for invoice checks
      };
      next();
    });

    app.use('/api/kyc', kycRoutes);
    app.use('/api/invoice', invoiceRoutes);

    // Error handler
    app.use((err, req, res, next) => {
      console.error("Test App Error:", err);
      res.status(500).json({ error: err.message });
    });
  });

  describe('Part 1: Authorization (KYC)', () => {
    it('should allow ADMIN to access /verify-wallet', async () => {
      const res = await request(app)
        .post('/api/kyc/verify-wallet')
        .set('X-Test-Role', 'admin')
        .send({ walletAddress: '0x123' }); // Payload doesn't matter for auth check, but controller mock returns 200

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should DENY normal user (buyer) access to /verify-wallet', async () => {
      const res = await request(app)
        .post('/api/kyc/verify-wallet')
        .set('X-Test-Role', 'buyer')
        .send({ walletAddress: '0x123' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/Access denied/);
    });

    it('should DENY normal user (seller) access to /verify-wallet', async () => {
        const res = await request(app)
          .post('/api/kyc/verify-wallet')
          .set('X-Test-Role', 'seller')
          .send({ walletAddress: '0x123' });

        expect(res.status).toBe(403);
    });
  });

  describe('Part 2: Input Validation (Invoice)', () => {
    // Valid Payload Base
    const validInvoice = {
      quotation_id: 123,
      invoice_id: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
      contract_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00', // Valid Address
      token_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
      due_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      discount_rate: 10,
      annual_apr: 20
    };

    it('should accept valid invoice data', async () => {
      const res = await request(app)
        .post('/api/invoice/')
        .set('X-Test-Role', 'seller') // Invoice create requires seller or admin
        .send(validInvoice);

      if (res.status !== 201) {
          console.log("Validation Errors:", res.body.errors);
      }
      expect(res.status).toBe(201);
    });

    it('should fail if contract_address is invalid (bad characters)', async () => {
      const res = await request(app)
        .post('/api/invoice/')
        .set('X-Test-Role', 'seller')
        .send({ ...validInvoice, contract_address: '0xINVALID' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'contract_address' })
        ])
      );
    });

    it('should fail if contract_address is invalid (wrong length)', async () => {
        const res = await request(app)
          .post('/api/invoice/')
          .set('X-Test-Role', 'seller')
          .send({ ...validInvoice, contract_address: '0x1234567890' });

        expect(res.status).toBe(400);
    });

    it('should fail if due_date is in the past', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // Yesterday
      const res = await request(app)
        .post('/api/invoice/')
        .set('X-Test-Role', 'seller')
        .send({ ...validInvoice, due_date: pastDate });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: 'Due date must be in future' })
        ])
      );
    });

    it('should fail if discount_rate is negative', async () => {
      const res = await request(app)
        .post('/api/invoice/')
        .set('X-Test-Role', 'seller')
        .send({ ...validInvoice, discount_rate: -5 });

      expect(res.status).toBe(400);
      expect(res.body.errors[0].message).toContain('Discount rate must be between');
    });

    it('should fail if discount_rate is > 100', async () => {
        const res = await request(app)
          .post('/api/invoice/')
          .set('X-Test-Role', 'seller')
          .send({ ...validInvoice, discount_rate: 150 });

        expect(res.status).toBe(400);
    });

    it('should fail if annual_apr is negative', async () => {
      const res = await request(app)
        .post('/api/invoice/')
        .set('X-Test-Role', 'seller')
        .send({ ...validInvoice, annual_apr: -1 });

      expect(res.status).toBe(400);
    });

    it('should fail if annual_apr is > 100', async () => {
        const res = await request(app)
          .post('/api/invoice/')
          .set('X-Test-Role', 'seller')
          .send({ ...validInvoice, annual_apr: 101 });

        expect(res.status).toBe(400);
    });
  });
});
