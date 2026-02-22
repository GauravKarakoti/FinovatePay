const assert = require('assert');
const path = require('path');

// --- Mock Database ---
const mockClient = {
  query: async (sql, params) => {
    // Log queries for verification
    mockClient.queries.push({ sql, params });

    // Mock responses based on SQL content
    if (sql === 'BEGIN') return {};
    if (sql === 'COMMIT') return {};
    if (sql === 'ROLLBACK') return {};

    // SELECT quotation
    if (sql.includes('SELECT * FROM quotations')) {
      if (mockClient.scenario === 'quotation_not_found') return { rows: [], rowCount: 0 };
      if (mockClient.scenario === 'quotation_invoiced') {
         return { rows: [{ id: 1, status: 'invoiced', seller_org_id: 'org1' }], rowCount: 1 };
      }
      // Default valid quotation
      return {
        rows: [{
          id: 1,
          status: 'approved',
          seller_org_id: 'org1',
          lot_id: mockClient.scenario === 'with_lot' ? 10 : null,
          quantity: 100,
          total_amount: 5000,
          currency: 'USD',
          seller_address: '0xSeller',
          buyer_address: '0xBuyer',
          description: 'Test Quotation',
          price_per_unit: 50
        }],
        rowCount: 1
      };
    }

    // SELECT produce_lots
    if (sql.includes('SELECT current_quantity FROM produce_lots')) {
       if (mockClient.scenario === 'insufficient_inventory') {
         return { rows: [{ current_quantity: 50 }], rowCount: 1 }; // Less than quotation quantity (100)
       }
       return { rows: [{ current_quantity: 200 }], rowCount: 1 };
    }

    // INSERT invoice
    if (sql.includes('INSERT INTO invoices')) {
      return { rows: [{ invoice_id: params[0] }] };
    }

    // UPDATE produce_lots
    if (sql.includes('UPDATE produce_lots')) {
      return {};
    }

    // UPDATE quotations
    if (sql.includes('UPDATE quotations')) {
      return {};
    }

    return { rows: [] };
  },
  release: () => { mockClient.released = true; },
  queries: [],
  released: false,
  scenario: 'success' // Default scenario
};

const mockPool = {
  connect: async () => mockClient
};

// --- Mock Setup ---
// We need to intercept the require call to return our mock pool
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(request) {
  if (request.endsWith('config/database')) {
    return { pool: mockPool };
  }
  return originalRequire.apply(this, arguments);
};

// Now load the controller with the mocked dependency
const invoiceController = require('../controllers/invoiceController');

// --- Test Runner ---
async function runTests() {
  console.log('🚀 Starting Invoice Controller Tests...\n');
  let passed = 0;
  let failed = 0;

  // Helper to run a test case
  async function test(name, setupFn, assertionsFn) {
    try {
      console.log(`Testing: ${name}`);
      // Reset mock state
      mockClient.queries = [];
      mockClient.released = false;
      mockClient.scenario = 'success';

      const req = {
        body: {
          quotation_id: 1,
          invoice_id: 'INV-001',
          invoice_hash: '0xHash',
          contract_address: '0xContract',
          token_address: '0xToken',
          due_date: '2023-12-31'
        },
        user: { organization_id: 'org1' }
      };
      const res = {
        status: (code) => ({ json: (data) => ({ code, data }) }), // Chainable mock
        statusCode: 0,
        responseData: null
      };
      // Spy on res.status/json
      res.status = function(code) {
        this.statusCode = code;
        return this;
      };
      res.json = function(data) {
        this.responseData = data;
        return this;
      };

      await setupFn(req);
      await invoiceController.createInvoice(req, res);
      await assertionsFn(res, mockClient);

      console.log('✅ Passed\n');
      passed++;
    } catch (err) {
      console.error('❌ Failed:', err.message);
      console.error(err.stack);
      failed++;
    }
  }

  // Test 1: Successful Invoice Creation (No Lot)
  await test('Success: Create Invoice (No Lot)',
    async (req) => { mockClient.scenario = 'success'; },
    async (res, client) => {
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(client.queries[0].sql, 'BEGIN');
      assert(client.queries[1].sql.includes('SELECT * FROM quotations')); // Check FOR UPDATE is there?
      assert(client.queries.some(q => q.sql.includes('INSERT INTO invoices')));
      assert(client.queries.some(q => q.sql.includes("UPDATE quotations SET status = 'invoiced'")));
      assert.strictEqual(client.queries[client.queries.length - 1].sql, 'COMMIT');
      assert.strictEqual(client.released, true);
    }
  );

  // Test 2: Successful Invoice Creation (With Lot)
  await test('Success: Create Invoice (With Lot)',
    async (req) => { mockClient.scenario = 'with_lot'; },
    async (res, client) => {
      assert.strictEqual(res.statusCode, 201);
      // Verify lot queries
      const lotSelect = client.queries.find(q => q.sql.includes('SELECT current_quantity FROM produce_lots'));
      assert(lotSelect, 'Should select lot');
      assert(lotSelect.sql.includes('FOR UPDATE'), 'Lot select should be FOR UPDATE');

      const lotUpdate = client.queries.find(q => q.sql.includes('UPDATE produce_lots'));
      assert(lotUpdate, 'Should update lot quantity');
    }
  );

  // Test 3: Quotation Not Found
  await test('Error: Quotation Not Found',
    async (req) => { mockClient.scenario = 'quotation_not_found'; },
    async (res, client) => {
      assert.strictEqual(res.statusCode, 404);
      assert(client.queries.some(q => q.sql === 'ROLLBACK'));
    }
  );

  // Test 4: Unauthorized (RBAC)
  await test('Error: Unauthorized',
    async (req) => {
        mockClient.scenario = 'success';
        req.user.organization_id = 'org2'; // Different org
    },
    async (res, client) => {
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.responseData.error, 'Not authorized: Quotation belongs to a different organization.');
      assert(client.queries.some(q => q.sql === 'ROLLBACK'));
    }
  );

  // Test 5: Insufficient Inventory
  await test('Error: Insufficient Inventory',
    async (req) => {
        // Need to ensure mock logic handles 'insufficient_inventory' correctly
        // The mock override at the bottom handles this scenario.
        mockClient.scenario = 'insufficient_inventory';
    },
    async (res, client) => {
      assert.strictEqual(res.statusCode, 400);
      assert(res.responseData.error.includes('Insufficient quantity'));
      assert(client.queries.some(q => q.sql === 'ROLLBACK'));
    }
  );

  console.log(`\nTests Completed: ${passed} Passed, ${failed} Failed`);
  if (failed > 0) process.exit(1);
}

// Need to refine mock logic for 'insufficient_inventory' to return a quotation with lot_id
const originalQuery = mockClient.query;
mockClient.query = async (sql, params) => {
    if (mockClient.scenario === 'insufficient_inventory') {
        if (sql.includes('SELECT * FROM quotations')) {
             return {
                rows: [{
                  id: 1,
                  status: 'approved',
                  seller_org_id: 'org1',
                  lot_id: 10, // HAS LOT
                  quantity: 100,
                  total_amount: 5000,
                  currency: 'USD',
                  seller_address: '0xSeller',
                  buyer_address: '0xBuyer',
                  description: 'Test Quotation',
                  price_per_unit: 50
                }],
                rowCount: 1
              };
        }
        if (sql.includes('SELECT current_quantity FROM produce_lots')) {
             return { rows: [{ current_quantity: 50 }], rowCount: 1 }; // Insufficient
        }
    }
    return originalQuery(sql, params);
};


runTests();
