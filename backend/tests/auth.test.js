const request = require('supertest');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Mock the database pool
const mockPool = {
  query: jest.fn()
};

// Mock the authenticateToken middleware
const mockAuthenticateToken = jest.fn((req, res, next) => {
  req.user = { id: 'mock-user-id' };
  next();
});

// Mock dependencies before requiring the route
jest.mock('../config/database', () => mockPool);
jest.mock('../middleware/auth', () => ({
  authenticateToken: mockAuthenticateToken
}));
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

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
      // Mock: user does not exist
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] }); // insert

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'buyer' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('buyer');
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });

    it('should register user with role "seller" when role is provided as seller', async () => {
      // Mock: user does not exist
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'seller' });

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
    });

    it('should default to "seller" role when no role is provided', async () => {
      // Mock: user does not exist
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData }); // No role provided

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
      
      // Verify the SQL was called with 'seller' as the role
      const insertCall = mockPool.query.mock.calls[1][0];
      expect(insertCall).toContain("'seller'");
    });

    it('should default to "seller" role when invalid role is provided', async () => {
      // Mock: user does not exist
      mockPool.query
        .mockResolvedValueOnce({ rows: [] }) // userExists check
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // insert

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'arbitrator' }); // Invalid role

      expect(response.status).toBe(201);
      expect(response.body.user.role).toBe('seller');
    });

    it('should reject user registration if email already exists', async () => {
      // Mock: user already exists
      mockPool.query.mockResolvedValueOnce({ 
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
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ id: 'existing-user-id' }] 
      });

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'seller' });

      expect(response.status).toBe(409);
    });

    it('should hash password before storing', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      await request(app)
        .post('/auth/register')
        .send({ ...validUserData, role: 'buyer' });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 10);
    });

    it('should return token on successful registration', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-jwt-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ ...validUserData });

      expect(response.body.token).toBe('mock-jwt-token');
    });

    it('should not allow arbitrator role (admin-only)', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] }); // Should default to seller

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

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
        mockPool.query
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

        bcrypt.hash.mockResolvedValue('hashedPassword');
        jwt.sign.mockReturnValue('mock-token');

        const response = await request(app)
          .post('/auth/register')
          .send({ ...validUserData, role: invalidRole });

        expect(response.body.user.role).toBe('seller');
      }
    });
  });

  describe('Role Validation Edge Cases', () => {
    it('should handle null role as seller', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test@example.com', password: 'pass', walletAddress: '0x742d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: null });

      expect(response.body.user.role).toBe('seller');
    });

    it('should handle undefined role as seller', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test2@example.com', password: 'pass', walletAddress: '0x842d35Cc6634C0532925a3b844Bc9e7595f0fE00' });

      expect(response.body.user.role).toBe('seller');
    });

    it('should handle empty string role as seller', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test3@example.com', password: 'pass', walletAddress: '0x942d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: '' });

      expect(response.body.user.role).toBe('seller');
    });

    it('should be case-sensitive - lowercase buyer should work', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'buyer' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test4@example.com', password: 'pass', walletAddress: '0xa42d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: 'buyer' });

      expect(response.body.user.role).toBe('buyer');
    });

    it('should treat uppercase Buyer as invalid (defaults to seller)', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ ...mockUser, role: 'seller' }] });

      bcrypt.hash.mockResolvedValue('hashedPassword');
      jwt.sign.mockReturnValue('mock-token');

      const response = await request(app)
        .post('/auth/register')
        .send({ email: 'test5@example.com', password: 'pass', walletAddress: '0xb42d35Cc6634C0532925a3b844Bc9e7595f0fE00', role: 'Buyer' });

      expect(response.body.user.role).toBe('seller');
    });
  });
});
