/**
 * Blockchain Transaction Queue System
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const Redis = require('ioredis');
const { ethers } = require('ethers');
const { pool } = require('../config/database');
const { getSigner, contractAddresses } = require('../config/blockchain');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');

const JOB_TYPES = {
  ESCROW_RELEASE: 'escrow:release',
  ESCROW_DISPUTE: 'escrow:dispute',
  ESCROW_DEPOSIT: 'escrow:deposit',
  STREAMING_CREATE: 'streaming:create',
  STREAMING_APPROVE: 'streaming:approve',
  STREAMING_RELEASE: 'streaming:release',
  STREAMING_PAUSE: 'streaming:pause',
  STREAMING_RESUME: 'streaming:resume',
  STREAMING_CANCEL: 'streaming:cancel',
  META_TRANSACTION: 'meta:transaction',
  CONTRACT_INTERACTION: 'contract:interaction',
  TOKEN_TRANSFER: 'token:transfer',
};

const RETRYABLE_ERRORS = [
  'NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'NONCE_EXPIRED',
  'REPLACEMENT_UNDERPRICED', 'INSUFFICIENT_FUNDS', 'CALL_EXCEPTION',
];

// Redis connection configuration optimized for Upstash / Serverless Redis
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const isTLS = redisUrl.startsWith('rediss://');
  
  const options = {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    family: 4,
    // Add auto-reconnect strategy for Upstash disconnects
    retryStrategy(times) {
      return Math.min(times * 50, 2000); 
    }
  };

  if (isTLS) {
    options.tls = { rejectUnauthorized: false };
  }

  const connection = new Redis(redisUrl, options);
  
  connection.on('error', (err) => {
    // Silence expected Upstash ECONNRESET drops, log actual errors
    if (err.code !== 'ECONNRESET') {
      console.error('[Redis] Connection error:', err.message);
    }
  });

  return connection;
};

const QUEUE_NAME = 'blockchain-transactions';
const MAX_RETRIES = parseInt(process.env.BLOCKCHAIN_MAX_RETRIES || '5');
const BACKOFF_MULTIPLIER = parseInt(process.env.BLOCKCHAIN_BACKOFF_MULTIPLIER || '2000');

class BlockchainQueue {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.queueEvents = null;
    this.io = null;
    this.connection = null;
    this.initialized = false;
  }

  initialize(io) {
    if (this.initialized) {
      console.warn('[BlockchainQueue] Already initialized');
      return;
    }

    this.io = io;
    this.connection = getRedisConnection();

    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: MAX_RETRIES,
        backoff: { type: 'exponential', delay: BACKOFF_MULTIPLIER },
        removeOnComplete: { count: 100, age: 24 * 3600 },
        removeOnFail: { count: 500, age: 7 * 24 * 3600 },
      },
    });

    this.queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection(),
    });

    // Prevent Unhandled Exception crashes from BullMQ internal connections
    this.queue.on('error', (err) => {
      if (err.code !== 'ECONNRESET') console.error('[Queue] Error:', err.message);
    });
    
    this.queueEvents.on('error', (err) => {
      if (err.code !== 'ECONNRESET') console.error('[QueueEvents] Error:', err.message);
    });

    this.setupEventListeners();
    this.initialized = true;
    console.log('[BlockchainQueue] Initialized successfully');
  }

  setupEventListeners() {
    this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`[BlockchainQueue] Job ${jobId} completed`);
      this.emitJobUpdate(jobId, 'completed', returnvalue);
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`[BlockchainQueue] Job ${jobId} failed:`, failedReason);
      this.emitJobUpdate(jobId, 'failed', { error: failedReason });
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      this.emitJobUpdate(jobId, 'progress', data);
    });

    this.queueEvents.on('active', ({ jobId }) => {
      this.emitJobUpdate(jobId, 'active', {});
    });
  }

  async emitJobUpdate(jobId, status, data) {
    if (!this.io) return;
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) return;
      const { invoiceId, streamId, userId } = job.data || {};
      const payload = { jobId, status, ...data, timestamp: new Date().toISOString() };

      if (invoiceId) this.io.to(`invoice-${invoiceId}`).emit('blockchain:job:update', { invoiceId, ...payload });
      if (streamId) this.io.to(`stream-${streamId}`).emit('blockchain:job:update', { streamId, ...payload });
      if (userId) this.io.to(`user-${userId}`).emit('blockchain:job:update', payload);
    } catch (error) {
      console.error('[BlockchainQueue] Error emitting job update:', error.message);
    }
  }

  async addJob(jobType, data, options = {}) {
    if (!this.initialized) throw new Error('BlockchainQueue not initialized.');
    const job = await this.queue.add(jobType, data, {
      ...options,
      jobId: options.jobId || `${jobType}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
    });
    await this.storeJobRecord(job.id, jobType, data);
    console.log(`[BlockchainQueue] Job ${job.id} added: ${jobType}`);
    return { jobId: job.id, jobType, status: 'pending' };
  }

  async storeJobRecord(jobId, jobType, data) {
    try {
      await pool.query(
        `INSERT INTO blockchain_jobs (job_id, job_type, status, payload, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (job_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload, updated_at = NOW()`,
        [jobId, jobType, 'pending', JSON.stringify(data)]
      );
    } catch (error) {}
  }

  async updateJobRecord(jobId, status, result = {}) {
    try {
      await pool.query(
        `UPDATE blockchain_jobs 
         SET status = $1, result = $2, updated_at = NOW(), completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
         WHERE job_id = $3`,
        [status, JSON.stringify(result), jobId]
      );
    } catch (error) {}
  }

  async getJobStatus(jobId) {
    if (!this.initialized) throw new Error('BlockchainQueue not initialized');
    const job = await this.queue.getJob(jobId);
    if (!job) {
      const dbResult = await pool.query('SELECT * FROM blockchain_jobs WHERE job_id = $1', [jobId]);
      return dbResult.rows[0] || null;
    }
    const state = await job.getState();
    return {
      jobId: job.id, jobType: job.name, status: state, data: job.data,
      returnvalue: job.returnvalue, failedReason: job.failedReason,
      attemptsMade: job.attemptsMade, timestamp: job.timestamp,
    };
  }

  async getStats() {
    if (!this.initialized) return null;
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(), this.queue.getActiveCount(),
      this.queue.getCompletedCount(), this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed, total: waiting + active + completed + failed + delayed };
  }

  startWorker() {
    if (this.worker) return;
    this.worker = new Worker(QUEUE_NAME, async (job) => this.processJob(job), {
      connection: getRedisConnection(),
      concurrency: parseInt(process.env.BLOCKCHAIN_QUEUE_CONCURRENCY || '3'),
      limiter: {
        max: parseInt(process.env.BLOCKCHAIN_RATE_LIMIT_MAX || '10'),
        duration: parseInt(process.env.BLOCKCHAIN_RATE_LIMIT_DURATION || '1000'),
      },
    });

    this.worker.on('error', (error) => {
      // Silence expected Upstash ECONNRESET drops
      if (error.code !== 'ECONNRESET') console.error('[BlockchainQueue] Worker error:', error.message);
    });

    console.log('[BlockchainQueue] Worker started');
  }

  async processJob(job) {
    const { name: jobType, id: jobId, data } = job;
    await job.updateProgress({ stage: 'started', attempt: job.attemptsMade + 1 });
    await this.updateJobRecord(jobId, 'processing');

    try {
      let result;
      switch (jobType) {
        case JOB_TYPES.ESCROW_RELEASE: result = await this.processEscrowRelease(data, job); break;
        case JOB_TYPES.ESCROW_DISPUTE: result = await this.processEscrowDispute(data, job); break;
        case JOB_TYPES.ESCROW_DEPOSIT: result = await this.processEscrowDeposit(data, job); break;
        case JOB_TYPES.STREAMING_CREATE: result = await this.processStreamingCreate(data, job); break;
        case JOB_TYPES.STREAMING_APPROVE: result = await this.processStreamingApprove(data, job); break;
        case JOB_TYPES.STREAMING_RELEASE: result = await this.processStreamingRelease(data, job); break;
        case JOB_TYPES.STREAMING_PAUSE: result = await this.processStreamingPause(data, job); break;
        case JOB_TYPES.STREAMING_RESUME: result = await this.processStreamingResume(data, job); break;
        case JOB_TYPES.STREAMING_CANCEL: result = await this.processStreamingCancel(data, job); break;
        case JOB_TYPES.META_TRANSACTION: result = await this.processMetaTransaction(data, job); break;
        case JOB_TYPES.CONTRACT_INTERACTION: result = await this.processContractInteraction(data, job); break;
        case JOB_TYPES.TOKEN_TRANSFER: result = await this.processTokenTransfer(data, job); break;
        default: throw new Error(`Unknown job type: ${jobType}`);
      }

      await job.updateProgress({ stage: 'completed', result });
      await this.updateJobRecord(jobId, 'completed', result);
      return result;
    } catch (error) {
      if (this.isRetryableError(error) && job.attemptsMade < job.opts.attempts) {
        await job.updateProgress({ stage: 'retrying', attempt: job.attemptsMade + 1, error: error.message });
        await this.updateJobRecord(jobId, 'retrying', { error: error.message });
        throw error; 
      }
      await this.updateJobRecord(jobId, 'failed', { error: error.message });
      throw error;
    }
  }

  isRetryableError(error) {
    const errorCode = error.code || error.reason;
    const errorMessage = error.message?.toLowerCase() || '';
    if (errorCode && RETRYABLE_ERRORS.includes(errorCode)) return true;
    const retryableMessages = ['network error', 'timeout', 'rate limit', 'too many requests', 'service unavailable', 'connection reset', 'nonce too low', 'underpriced', 'insufficient funds'];
    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  // ================= Job Processors =================
  async processEscrowRelease(data, job) {
    const { invoiceId, userId } = data;
    const signer = await getSigner();
    const escrowContract = new ethers.Contract(contractAddresses.escrowContract, EscrowContractArtifact.abi, signer);
    const tx = await escrowContract.confirmRelease(this.uuidToBytes32(invoiceId), { gasLimit: 500000 });
    const receipt = await tx.wait();
    await pool.query('UPDATE invoices SET escrow_status = $1, release_tx_hash = $2, updated_at = NOW() WHERE invoice_id = $3', ['released', tx.hash, invoiceId]);
    return { success: true, txHash: tx.hash, invoiceId };
  }

  async processEscrowDispute(data, job) {
    const { invoiceId, reason, userId } = data;
    const signer = await getSigner();
    const escrowContract = new ethers.Contract(contractAddresses.escrowContract, EscrowContractArtifact.abi, signer);
    const tx = await escrowContract.raiseDispute(this.uuidToBytes32(invoiceId), { gasLimit: 500000 });
    const receipt = await tx.wait();
    await pool.query('UPDATE invoices SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3, updated_at = NOW() WHERE invoice_id = $4', ['disputed', reason, tx.hash, invoiceId]);
    return { success: true, txHash: tx.hash, invoiceId };
  }

  async processEscrowDeposit(data, job) {
    const { invoiceId, amount, tokenAddress, userId } = data;
    const signer = await getSigner();
    const escrowContract = new ethers.Contract(contractAddresses.escrowContract, EscrowContractArtifact.abi, signer);
    if (tokenAddress && tokenAddress !== ethers.ZeroAddress) {
      const tokenContract = new ethers.Contract(tokenAddress, ['function approve(address spender, uint256 amount) returns (bool)'], signer);
      const approveTx = await tokenContract.approve(contractAddresses.escrowContract, amount);
      await approveTx.wait();
    }
    const overrides = tokenAddress === ethers.ZeroAddress ? { value: amount } : {};
    const tx = await escrowContract.deposit(this.uuidToBytes32(invoiceId), { ...overrides, gasLimit: 500000 });
    const receipt = await tx.wait();
    await pool.query('UPDATE invoices SET escrow_status = $1, deposit_tx_hash = $2, updated_at = NOW() WHERE invoice_id = $3', ['deposited', tx.hash, invoiceId]);
    return { success: true, txHash: tx.hash, invoiceId };
  }

  async processStreamingCreate(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.createStreamOnChain(data.streamId, data.sellerAddress, data.buyerAddress, data.totalAmount, data.interval, data.numPayments, data.tokenAddress, data.description);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processStreamingApprove(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.approveStreamOnChain(data.streamId, data.amount, data.tokenAddress);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processStreamingRelease(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.releasePaymentOnChain(data.streamId);
    const StreamingPayment = require('../models/StreamingPayment');
    await StreamingPayment.incrementReleased(data.streamId, result.amount, result.intervalsCompleted);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processStreamingPause(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.pauseStreamOnChain(data.streamId);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processStreamingResume(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.resumeStreamOnChain(data.streamId);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processStreamingCancel(data, job) {
    const streamingService = require('../services/streamingService');
    const result = await streamingService.cancelStreamOnChain(data.streamId);
    return { success: true, txHash: result.txHash, streamId: data.streamId };
  }

  async processMetaTransaction(data, job) {
    const signer = await getSigner();
    const contract = new ethers.Contract(data.contractAddress, data.contractAbi, signer);
    const tx = await contract.executeMetaTx(data.user, data.functionData, data.signature, { gasLimit: 500000 });
    const receipt = await tx.wait();
    return { success: true, txHash: tx.hash };
  }

  async processContractInteraction(data, job) {
    const signer = await getSigner();
    const contract = new ethers.Contract(data.contractAddress, data.contractAbi, signer);
    const tx = await contract[data.method](...data.args, { gasLimit: data.overrides?.gasLimit || 500000, value: data.overrides?.value || 0 });
    const receipt = await tx.wait();
    return { success: true, txHash: tx.hash };
  }

  async processTokenTransfer(data, job) {
    const signer = await getSigner();
    const tokenContract = new ethers.Contract(data.tokenAddress, ['function transfer(address to, uint256 amount) returns (bool)'], signer);
    const tx = await tokenContract.transfer(data.to, data.amount, { gasLimit: 100000 });
    const receipt = await tx.wait();
    return { success: true, txHash: tx.hash };
  }

  uuidToBytes32(uuid) {
    return ethers.zeroPadValue('0x' + uuid.replace(/-/g, ''), 32);
  }

  async shutdown() {
    if (this.worker) await this.worker.close();
    if (this.queueEvents) await this.queueEvents.close();
    if (this.queue) await this.queue.close();
    if (this.connection) await this.connection.quit();
    this.initialized = false;
  }
}

const blockchainQueue = new BlockchainQueue();

module.exports = {
  blockchainQueue,
  JOB_TYPES,
  QUEUE_NAME,
};