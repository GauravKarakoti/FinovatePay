/**
 * Security Test: Verify password hashes are not exposed in API responses
 * Tests for Issue #125: API Returns Password Hashes in Auth Responses
 */

const request = require('supertest');
const app = require('../server');

describe('Auth Security Tests - Issue #125', () => {
  const testUser = {
    email: `test-${Date.now()}@example.com`,
    password: 'TestPassword123!',
    walletAddress: `0x${Math.random().toString(16).substr(2, 40)}`,
    company_name: 'Test Company',
    tax_id: 'TEST123',
    first_name: 'Test',
    last_name: 'User'
  };

  let authToken;
  let userId;

  describe('POST /api/auth/register', () => {
    it('should NOT return password_hash in registration response', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(testUser)
        .expect(201);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      
      // CRITICAL: Verify password_hash is NOT in response
      expect(response.body.user).not.toHaveProperty('password_hash');
      expect(response.body.user).not.toHaveProperty('password');
      
      // Verify expected fields ARE present
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', testUser.email);
      expect(response.body.user).toHaveProperty('wallet_address', testUser.walletAddress);
      
      // Store for next tests
      authToken = response.body.token;
      userId = response.body.user.id;
    });
  });

  describe('POST /api/auth/login', () => {
    it('should NOT return password_hash in login response', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: testUser.password
        })
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('token');
      
      // CRITICAL: Verify password_hash is NOT in response
      expect(response.body.user).not.toHaveProperty('password_hash');
      expect(response.body.user).not.toHaveProperty('password');
      
      // Verify expected fields ARE present
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('email', testUser.email);
      expect(response.body.user).toHaveProperty('wallet_address', testUser.walletAddress);
    });

    it('should return proper error for invalid credentials without exposing data', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body).not.toHaveProperty('password_hash');
      expect(response.body).not.toHaveProperty('user');
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should NOT return password_hash in profile response', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // CRITICAL: Verify password_hash is NOT in response
      expect(response.body).not.toHaveProperty('password_hash');
      expect(response.body).not.toHaveProperty('password');
      
      // Verify expected fields ARE present
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('email', testUser.email);
    });
  });

  describe('PUT /api/auth/role', () => {
    it('should NOT return password_hash when updating role', async () => {
      const response = await request(app)
        .put('/api/auth/role')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ role: 'seller' })
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      
      // CRITICAL: Verify password_hash is NOT in response
      expect(response.body.user).not.toHaveProperty('password_hash');
      expect(response.body.user).not.toHaveProperty('password');
      
      // Verify expected fields ARE present
      expect(response.body.user).toHaveProperty('id');
      expect(response.body.user).toHaveProperty('role', 'seller');
    });
  });
});
