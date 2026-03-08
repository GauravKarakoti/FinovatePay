const request = require('supertest');
const express = require('express');

// Mocks
const mockPool = {
  connect: jest.fn().mockResolvedValue({
    query: jest.fn(),
    release: jest.fn()
  }),
  query: jest.fn()
};

const mockTx = { hash: '0xdeadbeef', wait: jest.fn().mockResolvedValue({}) };
const mockContract = {
  createEscrow: jest.fn().mockResolvedValue(mockTx)
};

const mockEthers = {
  zeroPadValue: jest.fn((hex, bytes) => hex),
  constants: { AddressZero: '0x0000000000000000000000000000000000000000' }
};

// Mock modules used by the route
jest.mock('../config/database', () => ({ pool: mockPool }));
jest.mock('ethers', () => mockEthers);
jest.mock('../config/blockchain', () => ({ getSigner: jest.fn(), contractAddresses: { escrowContract: '0x123' }, getEscrowContract: jest.fn(() => mockContract) }));
jest.mock('../../deployed/EscrowContract.json', () => ({ abi: [] }), { virtual: true });
jest.mock('../middleware/auditLogger', () => ({ logAudit: jest.fn() }));

// Bypass auth and kyc middleware used by the router
jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => { req.user = { id: 'u1', wallet_address: '0xSeller', role: 'seller' }; next(); },
  requireRole: () => (req, res, next) => next()
}));
jest.mock('../middleware/kycValidation', () => ({ requireKYC: (req, res, next) => next() }));

// Now import the router after mocks
const escrowRouter = require('../routes/escrow');

describe('Escrow multi-party route', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/v1/escrow', escrowRouter);
  });

  it('creates a multi-party escrow successfully', async () => {
    // Setup DB mock to return an invoice
    const client = { query: jest.fn(), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    client.query.mockResolvedValueOnce({ rows: [{ invoice_id: 'inv-1', seller_address: '0xSeller', buyer_address: '0xBuyer', token_address: '0xToken', amount: 100, escrow_status: 'created' }] });

    const res = await request(app)
      .post('/api/v1/escrow/multi-party')
      .send({ invoiceId: 'inv-1', durationSeconds: 3600 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe(mockTx.hash);
    expect(mockContract.createEscrow).toHaveBeenCalled();
  });

  it('returns 400 when invoiceId missing', async () => {
    const res = await request(app)
      .post('/api/v1/escrow/multi-party')
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns error when invoice not found', async () => {
    const client = { query: jest.fn(), release: jest.fn() };
    mockPool.connect.mockResolvedValue(client);
    client.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/escrow/multi-party')
      .send({ invoiceId: 'missing' });

    expect(res.status).toBe(500);
  });
});
