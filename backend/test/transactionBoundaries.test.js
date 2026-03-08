const request = require('supertest');
const { pool } = require('../config/database');
const TransactionWrapper = require('../utils/transactionWrapper');
const IdempotencyKeyManager = require('../utils/idempotencyKey');
const StateSnapshotManager = require('../utils/stateSnapshot');
const TransactionAuditTrail = require('../utils/transactionAuditTrail');

describe('Transaction Boundary and ACID Property Tests', () => {
  let testServer;

  beforeAll(async () => {
    // Initialize test database schema if not exists
    await setupTestDatabase();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function setupTestDatabase() {
    const client = await pool.connect();
    try {
      // Create test tables
      await client.query(`
        CREATE TABLE IF NOT EXISTS test_transactions (
          id SERIAL PRIMARY KEY,
          correlation_id uuid,
          status VARCHAR(50),
          amount DECIMAL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS idempotency_keys (
          idempotency_key VARCHAR(255) PRIMARY KEY,
          operation_type VARCHAR(100),
          operation_data jsonb,
          result jsonb,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS blockchain_operation_snapshots (
          snapshot_id uuid PRIMARY KEY,
          operation_type VARCHAR(100),
          entity_type VARCHAR(100),
          entity_id VARCHAR(255),
          snapshot_type VARCHAR(20),
          state_data jsonb,
          related_snapshot_id uuid,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS transaction_audit_trail (
          audit_id uuid PRIMARY KEY,
          correlation_id uuid,
          operation_type VARCHAR(100),
          entity_type VARCHAR(100),
          entity_id VARCHAR(255),
          action VARCHAR(100),
          actor_id VARCHAR(255),
          status VARCHAR(50),
          metadata jsonb,
          ip_address VARCHAR(50),
          user_agent TEXT,
          transaction_hash VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await client.release();
    } finally {
      client.release();
    }
  }

  describe('TransactionWrapper Tests', () => {
    test('should successfully commit transaction with multiple steps', async () => {
      const result = await TransactionWrapper.withTransaction(
        async (tx) => {
          const step1 = await tx.query(
            'INSERT_TEST_RECORD',
            'INSERT INTO test_transactions (correlation_id, status, amount) VALUES ($1, $2, $3) RETURNING *',
            ['test-123', 'PENDING', 100]
          );

          const step2 = await tx.query(
            'UPDATE_TEST_RECORD',
            'UPDATE test_transactions SET status = $1 WHERE correlation_id = $2',
            ['COMPLETED', 'test-123']
          );

          return { step1: step1.rows[0], step2: step2.rowCount };
        },
        'TEST_TRANSACTION'
      );

      expect(result.success).toBe(true);
      expect(result.result.step1.status).toBe('PENDING');
      expect(result.context.stepsCompleted).toHaveLength(2);
    });

    test('should rollback transaction on error', async () => {
      const result = await TransactionWrapper.withTransaction(
        async (tx) => {
          await tx.query(
            'INSERT_TEST',
            'INSERT INTO test_transactions (status, amount) VALUES ($1, $2)',
            ['TEST', 100]
          );

          throw new Error('Intentional error for rollback test');
        },
        'ROLLBACK_TEST'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Intentional error for rollback test');
    });

    test('should track snapshots during transaction', async () => {
      const result = await TransactionWrapper.withTransaction(
        async (tx) => {
          tx.addSnapshot('BEFORE', { status: 'PENDING', amount: 100 });
          tx.addSnapshot('AFTER', { status: 'COMPLETED', amount: 100 });

          return {
            before: tx.getSnapshot('BEFORE'),
            after: tx.getSnapshot('AFTER'),
          };
        },
        'SNAPSHOT_TEST'
      );

      expect(result.result.before.data.status).toBe('PENDING');
      expect(result.result.after.data.status).toBe('COMPLETED');
    });
  });

  describe('Idempotency Key Tests', () => {
    test('should generate consistent idempotency keys', () => {
      const data = { invoiceId: '123', amount: 100 };
      const key1 = IdempotencyKeyManager.generateKey('escrow-release', data);
      const key2 = IdempotencyKeyManager.generateKey('escrow-release', data);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^escrow-release_/);
    });

    test('should record and retrieve idempotency keys', async () => {
      const key = IdempotencyKeyManager.generateKey('test-op', { data: 'test' });
      const result = { success: true, id: 'result-123' };

      await IdempotencyKeyManager.recordKey(key, 'TEST_OPERATION', { data: 'test' }, result);
      const retrieved = await IdempotencyKeyManager.checkKey(key);

      expect(retrieved).toEqual(result);
    });

    test('should return null for non-existent keys', async () => {
      const result = await IdempotencyKeyManager.checkKey('non-existent-key');
      expect(result).toBeNull();
    });
  });

  describe('State Snapshot Tests', () => {
    test('should create and retrieve before snapshot', async () => {
      const beforeState = { status: 'PENDING', amount: 100 };
      const snapshotId = await StateSnapshotManager.createBeforeSnapshot(
        'ESCROW_RELEASE',
        'INVOICE',
        'invoice-123',
        beforeState
      );

      const snapshot = await StateSnapshotManager.getSnapshot(snapshotId);
      expect(snapshot.snapshot_type).toBe('BEFORE');
      expect(snapshot.state_data).toEqual(beforeState);
    });

    test('should create and retrieve after snapshot', async () => {
      const beforeState = { status: 'PENDING', amount: 100 };
      const afterState = { status: 'RELEASED', amount: 100 };

      const beforeId = await StateSnapshotManager.createBeforeSnapshot(
        'ESCROW_RELEASE',
        'INVOICE',
        'invoice-456',
        beforeState
      );

      const afterId = await StateSnapshotManager.createAfterSnapshot(
        'ESCROW_RELEASE',
        'INVOICE',
        'invoice-456',
        afterState,
        beforeId
      );

      const { beforeSnapshot, afterSnapshot } = await StateSnapshotManager.getSnapshotPair(beforeId);

      expect(beforeSnapshot.state_data.status).toBe('PENDING');
      expect(afterSnapshot.state_data.status).toBe('RELEASED');
    });

    test('should verify state consistency', async () => {
      const beforeState = { status: 'PENDING' };
      const afterState = { status: 'COMPLETED' };

      const beforeId = await StateSnapshotManager.createBeforeSnapshot(
        'TEST_OP',
        'ENTITY',
        'entity-789',
        beforeState
      );

      await StateSnapshotManager.createAfterSnapshot(
        'TEST_OP',
        'ENTITY',
        'entity-789',
        afterState,
        beforeId
      );

      const verification = await StateSnapshotManager.verifyStateConsistency(beforeId);

      expect(verification.consistent).toBe(true);
      expect(verification.validations.sameEntity).toBe(true);
      expect(verification.validations.sameOperation).toBe(true);
    });
  });

  describe('Transaction Audit Trail Tests', () => {
    test('should log transaction audit entry', async () => {
      const auditId = await TransactionAuditTrail.logTransaction({
        correlationId: 'corr-123',
        operationType: 'ESCROW_RELEASE',
        entityType: 'INVOICE',
        entityId: 'invoice-999',
        action: 'RELEASE',
        actorId: 'user-123',
        status: 'SUCCESS',
        metadata: { txHash: '0x123' },
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
      });

      expect(auditId).toBeDefined();
    });

    test('should retrieve audit trail by correlation ID', async () => {
      const correlationId = 'corr-456';

      await TransactionAuditTrail.logTransaction({
        correlationId,
        operationType: 'TEST_OP',
        entityType: 'TEST',
        entityId: 'test-1',
        action: 'CREATE',
        actorId: 'user-1',
        status: 'SUCCESS',
        metadata: {},
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      const trail = await TransactionAuditTrail.getAuditTrail(correlationId);

      expect(trail.length).toBeGreaterThan(0);
      expect(trail[0].correlation_id).toBe(correlationId);
    });

    test('should retrieve entity audit trail', async () => {
      const entityId = 'entity-audit-test';

      await TransactionAuditTrail.logTransaction({
        correlationId: 'corr-entity',
        operationType: 'TEST_OP',
        entityType: 'TEST_ENTITY',
        entityId,
        action: 'UPDATE',
        actorId: 'user-1',
        status: 'SUCCESS',
        metadata: {},
        ipAddress: '127.0.0.1',
        userAgent: 'Test',
      });

      const trail = await TransactionAuditTrail.getEntityAuditTrail('TEST_ENTITY', entityId);

      expect(trail.length).toBeGreaterThan(0);
      expect(trail[0].entity_id).toBe(entityId);
    });

    test('should query audit trail with filters', async () => {
      const result = await TransactionAuditTrail.queryAuditTrail({
        status: 'SUCCESS',
        limit: 10,
      });

      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('ACID Property Tests', () => {
    test('should maintain atomicity - all or nothing', async () => {
      const result = await TransactionWrapper.withTransaction(
        async (tx) => {
          await tx.query('step1', 'INSERT INTO test_transactions (status, amount) VALUES ($1, $2)', [
            'TEST',
            50,
          ]);

          throw new Error('Simulated failure');
        },
        'ATOMICITY_TEST'
      );

      expect(result.success).toBe(false);
      // Verify record was not inserted due to rollback
      const check = await pool.query(
        "SELECT COUNT(*) FROM test_transactions WHERE status = 'TEST' AND amount = 50"
      );
      expect(parseInt(check.rows[0].count)).toBe(0);
    });

    test('should maintain consistency via transaction boundaries', async () => {
      await TransactionWrapper.withTransaction(
        async (tx) => {
          await tx.query('create', 'INSERT INTO test_transactions (status, amount) VALUES ($1, $2)', [
            'VALID',
            100,
          ]);

          const result = await tx.query('read', 'SELECT * FROM test_transactions WHERE status = $1', ['VALID']);

          return result.rows[0];
        },
        'CONSISTENCY_TEST'
      );

      const finalCheck = await pool.query("SELECT COUNT(*) FROM test_transactions WHERE status = 'VALID'");
      expect(parseInt(finalCheck.rows[0].count)).toBeGreaterThan(0);
    });

    test('should prevent duplicate operations via idempotency', async () => {
      const key = IdempotencyKeyManager.generateKey('duplicate-test', { id: 'same' });
      const result1 = { success: true, processedAt: new Date() };

      await IdempotencyKeyManager.recordKey(key, 'DUPLICATE_TEST', { id: 'same' }, result1);
      const result2 = await IdempotencyKeyManager.checkKey(key);

      expect(result2).toEqual(result1);
    });
  });
});
