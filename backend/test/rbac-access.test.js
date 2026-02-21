const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock environment variables
process.env.DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; 
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Mock state
let currentUserRole = 'buyer';
const mockUserId = 123;

// Mock database pool logic
const mockQuery = jest.fn(async (text, params) => {
    // 1. Auth Middleware: Fetch user by ID
    // Note: The query string must match exactly or loosely what backend/middleware/auth.js does
    if (text.includes('SELECT id, email, wallet_address, role, organization_id FROM users WHERE id')) {
        // console.log("Mock DB: Fetching user for Auth, returning role:", currentUserRole);
        return {
            rows: [{
                id: mockUserId,
                role: currentUserRole,
                email: 'test@example.com',
                wallet_address: '0x123',
                organization_id: 1,
                kyc_status: 'verified', // needed for kyc middleware
                // other fields if needed ...
            }]
        };
    }
    // 2. Admin Check Logic / manual role check
    if (text.includes('SELECT role FROM users')) {
        return { rows: [{ role: currentUserRole }] };
    }
    
    // 3. KYC Middleware
    if (text.includes('SELECT kyc_status FROM users WHERE wallet_address')) {
        return { rows: [{ kyc_status: 'verified' }] };
    }
    
    // Default empty result for other queries
    return { rows: [] };
});

const mockPool = {
    query: mockQuery,
    connect: jest.fn(),
    on: jest.fn(),
};

// Mock config/database
jest.mock('../config/database', () => ({
    pool: mockPool
}));

// Mock config/blockchain to avoid ENS/Provider errors
jest.mock('../config/blockchain', () => {
    return {
        contractAddresses: {
            produceTracking: '0x123',
            escrowContract: '0x456',
            invoiceFactory: '0x789',
            financingManager: '0xabc',
            fractionToken: '0xdef',
            arbitratorsRegistry: '0xghijk',
            complianceManager: '0xlmn',
            liquidityAdapter: '0xopq',
            bridgeAdapter: '0xrst',
            minimalForwarder: '0xuvw',
            MinimalForwarder: '0xuvw', // Casing compatibility
            ProduceTracking: '0x123',
        },
        getSigner: jest.fn(() => ({
             getAddress: async () => '0xDeployer',
             provider: { getNetwork: async () => ({ chainId: 1337 }) }
        })),
        getProvider: jest.fn(() => ({
             getNetwork: async () => ({ chainId: 1337 }) 
        })),
        getFractionTokenContract: jest.fn(),
        getEscrowContract: jest.fn(),
        getFinancingManagerContract: jest.fn(),
        // Add any other exports needed
    };
});

const app = require('../server');

describe('RBAC Authorization Tests', () => {
    let authToken;

    beforeAll(() => {
        // Generate a valid token
        authToken = jwt.sign({ id: mockUserId }, process.env.JWT_SECRET);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        currentUserRole = 'buyer'; // Reset default role
    });

    test('Accessing Admin Routes as a non-admin should return 403', async () => {
        currentUserRole = 'buyer';
        const res = await request(app)
            .get('/api/admin/users') // Admin only route
            .set('Authorization', `Bearer ${authToken}`);
        
        expect(res.status).toBe(403);
    });

    test('Accessing Admin Routes as Admin should work (not 403)', async () => {
        currentUserRole = 'admin';
        const res = await request(app)
            .get('/api/admin/users')
            .set('Authorization', `Bearer ${authToken}`);
        
        expect(res.status).not.toBe(403);
    });

    test('Accessing seller-only route as buyer should return 403', async () => {
        currentUserRole = 'buyer';
        const res = await request(app)
            .post('/api/invoices') // Seller only
            .set('Authorization', `Bearer ${authToken}`)
            .send({});

        if (res.status === 404) {
             console.log('Test 3 returned 404. Ensure /api/invoices is mounted.');
        }

        expect(res.status).toBe(403);
    });

    test('Accessing seller-only route as seller should work (not 403)', async () => {
        currentUserRole = 'seller';
        const res = await request(app)
            .post('/api/invoices')
            .set('Authorization', `Bearer ${authToken}`)
            .send({});

        expect(res.status).not.toBe(403);
    });

    test('Accessing investor-only route as seller should return 403', async () => {
        currentUserRole = 'seller';
        const res = await request(app)
            .post('/api/investor/record-investment') // Investor only
            .set('Authorization', `Bearer ${authToken}`)
            .send({});

        expect(res.status).toBe(403);
    });

    test('Accessing investor-only route as investor should work (not 403)', async () => {
        currentUserRole = 'investor';
        const res = await request(app)
            .post('/api/investor/record-investment')
            .set('Authorization', `Bearer ${authToken}`)
            //.send({}); // Don't care about body validation, just want past the auth middleware

        expect(res.status).not.toBe(403);
    });
});
