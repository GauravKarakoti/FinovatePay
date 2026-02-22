const request = require('supertest');
const express = require('express');

// Mock the database pool before importing anything
const mockQuery = jest.fn();

// Mock the database module
jest.mock('../config/database', () => ({
  pool: {
    query: jest.fn((...args) => mockQuery(...args))
  }
}));

// Mock the auth middleware
jest.mock('../middleware/auth', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = { id: 'mock-user-id' };
    next();
  })
}));

// Mock bcrypt and jwt
jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn()
}));

describe('Auth Registration Tests', () => {
  let app;
  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
    company_name: 'Test Corp',
    first_name: 'John',
    last_name: 'Doe',
    role: 'buyer',
    created_at: new Date()
  };

  beforeAll(() => {
    // Set up JWT secret for tests
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.NODE_ENV = 'test';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockReset();
    
    // Import mocks after jest.clearAllMocks to ensure fresh mocks
    const bcrypt = require('bcryptjs');
    const jwt = require('jsonwebtoken');
    
    bcrypt.hash.mockResolvedValue('hashedPassword');
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('mock-token');

    // Create a fresh Express app for each test
    app = express();
    app.use(express.json());
    
    // Import and use the auth routes
    const authRoutes = require('../routes/auth');
    app.use('/auth', authRoutes);
  });

  describe('POST /auth/register', () => {
    const validUserData = {
      email: 'test@example.com',
      password: 'password123',
      walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00',
      company_name: 'Test Corp',
      tax_id: 'TAX123',
      first_name: 'John',
      last_name: 'Doe'
    };

    it('should register user with role "buyer" when role is provided as buyer', async () => {
      const bcrypt = require('bcryptjs');
      const jwt = require('jsonwebtoken');
      
      // Mock: user does not exist
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] }); // insert

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'buyer' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('buyer');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('should register user with role "seller" when role is provided as seller', async () => {
      // Mock: user does not exist
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'seller' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
    });

    it('should default to "seller" role when no role is provided', async () => {
      // Mock: user does not exist
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData }); // No role provided

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
      
      // Verify the SQL was called with 'seller' as the role (in the parameters array)
      const insertParams = mockQuery.mock.calls[1][1];
      expect(insertParams[6]).toBe('seller');
    });

    it('should default to "seller" role when invalid role is provided', async () => {
      // Mock: user does not exist
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'arbitrator' }); // Invalid role

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
    });

    it('should reject user registration if email already exists', async () => {
      // Mock: user already exists
      mockQuery.mockResolvedValueOnce({ 
        rows: [{ id: 'existing-user-id' }] 
      });

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'buyer' });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('User with this email or wallet address already exists');
    });

    it('should reject user registration if wallet address already exists', async () => {
      // Mock: user already exists (same wallet)
      mockQuery.mockResolvedValueOnce({ 
        rows: [{ id: 'existing-user-id' }] 
      });

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'seller' });

      expect(response.status).toBe(409);
    });

    it('should hash password before storing', async () => {
      const bcrypt = require('bcryptjs');
      
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] });

      await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'buyer' });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('should return token on successful registration', async () => {
      const jwt = require('jsonwebtoken');
      
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser }] });

      jwt.sign.mockReturnValue('mock-jwt-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData });

      expect(response.body.token).toBe('mock-jwt-token');
    });

    it('should not allow arbitrator role (admin-only)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // Should default to seller

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'arbitrator' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller'); // Should default to seller, not arbitrator
    });

    it('should allow investor role when provided', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'investor' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'investor' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('investor');
    });

    it('should allow shipment role when provided', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'shipment' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'shipment' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('shipment');
    });

    it('should not allow invalid roles like admin, arbitrator, moderator', async () => {
      const invalidRoles = ['admin', 'arbitrator', 'moderator', 'ABC'];

      for (const invalidRole of invalidRoles) {
        mockQuery
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

        const response = await request(app)
          .post('/auth/register')
          .send({ ...validUserData, role: invalidRole });

        expect(response.body.user.role).toBe('seller');
      }
    });
  });

  describe('Role Validation Edge Cases', () => {
    it('should handle null role as seller', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'pass', walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: null });

      expect(response.body.user.role).toBe('seller');
    });

    it('should handle undefined role as seller', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test2@example.com', password: 'pass', walletAddress: '0x842d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.body.user.role).toBe('seller');
    });

    it('should handle empty string role as seller', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test3@example.com', password: 'pass', walletAddress: '0x942d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: '' });

      expect(response.body.user.role).toBe('seller');
    });

    it('should be case-sensitive - lowercase buyer should work', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test4@example.com', password: 'pass', walletAddress: '0xa42d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: 'buyer' });

      expect(response.body.user.role).toBe('buyer');
    });

    it('should treat uppercase Buyer as invalid (defaults to seller)', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test5@example.com', password: 'pass', walletAddress: '0xb42d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: 'Buyer' });

      expect(response.body.user.role).toBe('seller');
    });
  });
});
