/**
 * Blockchain Transaction Queue System
 * 
 * This module provides a robust queue-based system for processing blockchain operations
 * asynchronously using BullMQ. It handles:
 * - Transaction submission with retry logic
 * - Escrow release operations
 * - Payment confirmations
 * - Contract interactions
 * 
 * Benefits:
 * - Decoupled transaction processing from API routes
 * - Automatic retries with exponential backoff
 * - Persistent job storage (survives server restarts)
 * - Rate limit handling
 * - Real-time status updates via Socket.io
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const Redis = require('ioredis');
const { ethers } = require('ethers');
const { pool } = require('../config/database');
const { getSigner, getProvider, contractAddresses } = require('../config/blockchain');
const EscrowContractArtifact = require('../../deployed/EscrowContract.json');

// Job types supported by the blockchain queue
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

// Retryable blockchain error codes
const RETRYABLE_ERRORS = [
  'NETWORK_ERROR',
  'TIMEOUT',
  'SERVER_ERROR',
  'NONCE_EXPIRED',
  'REPLACEMENT_UNDERPRICED',
  'INSUFFICIENT_FUNDS',
  'CALL_EXCEPTION', // Sometimes transient
];

// Redis connection configuration
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
};

// Queue configuration
const QUEUE_NAME = 'blockchain-transactions';
const MAX_RETRIES = parseInt(process.env.BLOCKCHAIN_MAX_RETRIES || '5');
const BACKOFF_MULTIPLIER = parseInt(process.env.BLOCKCHAIN_BACKOFF_MULTIPLIER || '2000');

/**
 * BlockchainQueue class manages the queue lifecycle and provides
 * methods to add and manage blockchain jobs
 */
class BlockchainQueue {
  constructor() {
    this.queue = null;
    this.worker = null;
    this.queueEvents = null;
    this.io = null; // Socket.io instance
    this.connection = null;
    this.initialized = false;
  }

  /**
   * Initialize the queue system
   * @param {Object} io - Socket.io instance for real-time updates
   */
  initialize(io) {
    if (this.initialized) {
      console.warn('[BlockchainQueue] Already initialized');
      return;
    }

    this.io = io;
    this.connection = getRedisConnection();

    // Create the queue
    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: MAX_RETRIES,
        backoff: {
          type: 'exponential',
          delay: BACKOFF_MULTIPLIER,
        },
        removeOnComplete: {
          count: 100, // Keep last 100 completed jobs
          age: 24 * 3600, // For 24 hours
        },
        removeOnFail: {
          count: 500, // Keep last 500 failed jobs
          age: 7 * 24 * 3600, // For 7 days
        },
      },
    });

    // Create queue events for monitoring
    this.queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection(),
    });

    this.setupEventListeners();
    this.initialized = true;

    console.log('[BlockchainQueue] Initialized successfully');
  }

  /**
   * Set up event listeners for job lifecycle
   */
  setupEventListeners() {
    this.queueEvents.on('completed', ({ jobId, returnvalue }) => {
      console.log(`[BlockchainQueue] Job ${jobId} completed:`, returnvalue?.txHash);
      this.emitJobUpdate(jobId, 'completed', returnvalue);
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      console.error(`[BlockchainQueue] Job ${jobId} failed:`, failedReason);
      this.emitJobUpdate(jobId, 'failed', { error: failedReason });
    });

    this.queueEvents.on('progress', ({ jobId, data }) => {
      console.log(`[BlockchainQueue] Job ${jobId} progress:`, data);
      this.emitJobUpdate(jobId, 'progress', data);
    });

    this.queueEvents.on('waiting', ({ jobId }) => {
      console.log(`[BlockchainQueue] Job ${jobId} waiting`);
    });

    this.queueEvents.on('active', ({ jobId }) => {
      console.log(`[BlockchainQueue] Job ${jobId} active`);
      this.emitJobUpdate(jobId, 'active', {});
    });

    this.queueEvents.on('delayed', ({ jobId, delay }) => {
      console.log(`[BlockchainQueue] Job ${jobId} delayed by ${delay}ms`);
    });
  }

  /**
   * Emit real-time updates via Socket.io
   * @param {string} jobId - Job identifier
   * @param {string} status - Job status
   * @param {Object} data - Additional data
   */
  async emitJobUpdate(jobId, status, data) {
    if (!this.io) return;

    try {
      // Get job metadata to find associated room
      const job = await this.queue.getJob(jobId);
      if (!job) return;

      const { invoiceId, streamId, userId } = job.data || {};

      // Emit to specific rooms
      if (invoiceId) {
        this.io.to(`invoice-${invoiceId}`).emit('blockchain:job:update', {
          jobId,
          status,
          invoiceId,
          ...data,
          timestamp: new Date().toISOString(),
        });
      }

      if (streamId) {
        this.io.to(`stream-${streamId}`).emit('blockchain:job:update', {
          jobId,
          status,
          streamId,
          ...data,
          timestamp: new Date().toISOString(),
        });
      }

      // Also emit to user-specific room
      if (userId) {
        this.io.to(`user-${userId}`).emit('blockchain:job:update', {
          jobId,
          status,
          ...data,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (error) {
      console.error('[BlockchainQueue] Error emitting job update:', error);
    }
  }

  /**
   * Add a job to the blockchain queue
   * @param {string} jobType - Type of blockchain operation
   * @param {Object} data - Job data
   * @param {Object} options - Additional job options
   * @returns {Promise<Object>} Job details
   */
  async addJob(jobType, data, options = {}) {
    if (!this.initialized) {
      throw new Error('BlockchainQueue not initialized. Call initialize() first.');
    }

    const job = await this.queue.add(jobType, data, {
      ...options,
      jobId: options.jobId || `${jobType}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`,
    });

    // Store job in database for persistence and tracking
    await this.storeJobRecord(job.id, jobType, data);

    console.log(`[BlockchainQueue] Job ${job.id} added: ${jobType}`);

    return {
      jobId: job.id,
      jobType,
      status: 'pending',
    };
  }

  /**
   * Store job record in database
   * @param {string} jobId - Job identifier
   * @param {string} jobType - Type of operation
   * @param {Object} data - Job data
   */
  async storeJobRecord(jobId, jobType, data) {
    try {
      await pool.query(
        `INSERT INTO blockchain_jobs (job_id, job_type, status, payload, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (job_id) DO UPDATE SET 
           status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           updated_at = NOW()`,
        [jobId, jobType, 'pending', JSON.stringify(data)]
      );
    } catch (error) {
      console.error('[BlockchainQueue] Error storing job record:', error);
      // Don't throw - database storage is secondary
    }
  }

  /**
   * Update job record in database
   * @param {string} jobId - Job identifier
   * @param {string} status - New status
   * @param {Object} result - Job result
   */
  async updateJobRecord(jobId, status, result = {}) {
    try {
      await pool.query(
        `UPDATE blockchain_jobs 
         SET status = $1, result = $2, updated_at = NOW(), completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
         WHERE job_id = $3`,
        [status, JSON.stringify(result), jobId]
      );
    } catch (error) {
      console.error('[BlockchainQueue] Error updating job record:', error);
    }
  }

  /**
   * Get job status
   * @param {string} jobId - Job identifier
   * @returns {Promise<Object|null>} Job state and details
   */
  async getJobStatus(jobId) {
    if (!this.initialized) {
      throw new Error('BlockchainQueue not initialized');
    }

    const job = await this.queue.getJob(jobId);
    if (!job) {
      // Check database for completed jobs
      const dbResult = await pool.query(
        'SELECT * FROM blockchain_jobs WHERE job_id = $1',
        [jobId]
      );
      return dbResult.rows[0] || null;
    }

    const state = await job.getState();

    return {
      jobId: job.id,
      jobType: job.name,
      status: state,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  /**
   * Get queue statistics
   * @returns {Promise<Object>} Queue stats
   */
  async getStats() {
    if (!this.initialized) {
      return null;
    }

    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed,
    };
  }

  /**
   * Start the queue worker
   */
  startWorker() {
    if (this.worker) {
      console.warn('[BlockchainQueue] Worker already running');
      return;
    }

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => this.processJob(job),
      {
        connection: getRedisConnection(),
        concurrency: parseInt(process.env.BLOCKCHAIN_QUEUE_CONCURRENCY || '3'),
        limiter: {
          max: parseInt(process.env.BLOCKCHAIN_RATE_LIMIT_MAX || '10'),
          duration: parseInt(process.env.BLOCKCHAIN_RATE_LIMIT_DURATION || '1000'), // per second
        },
      }
    );

    this.worker.on('error', (error) => {
      console.error('[BlockchainQueue] Worker error:', error);
    });

    console.log('[BlockchainQueue] Worker started');
  }

  /**
   * Process a blockchain job
   * @param {Job} job - BullMQ job object
   * @returns {Promise<Object>} Processing result
   */
  async processJob(job) {
    const { name: jobType, id: jobId, data } = job;
    
    console.log(`[BlockchainQueue] Processing job ${jobId} of type ${jobType}`);
    
    await job.updateProgress({ stage: 'started', attempt: job.attemptsMade + 1 });
    await this.updateJobRecord(jobId, 'processing');

    try {
      let result;

      switch (jobType) {
        case JOB_TYPES.ESCROW_RELEASE:
          result = await this.processEscrowRelease(data, job);
          break;

        case JOB_TYPES.ESCROW_DISPUTE:
          result = await this.processEscrowDispute(data, job);
          break;

        case JOB_TYPES.ESCROW_DEPOSIT:
          result = await this.processEscrowDeposit(data, job);
          break;

        case JOB_TYPES.STREAMING_CREATE:
          result = await this.processStreamingCreate(data, job);
          break;

        case JOB_TYPES.STREAMING_APPROVE:
          result = await this.processStreamingApprove(data, job);
          break;

        case JOB_TYPES.STREAMING_RELEASE:
          result = await this.processStreamingRelease(data, job);
          break;

        case JOB_TYPES.STREAMING_PAUSE:
          result = await this.processStreamingPause(data, job);
          break;

        case JOB_TYPES.STREAMING_RESUME:
          result = await this.processStreamingResume(data, job);
          break;

        case JOB_TYPES.STREAMING_CANCEL:
          result = await this.processStreamingCancel(data, job);
          break;

        case JOB_TYPES.META_TRANSACTION:
          result = await this.processMetaTransaction(data, job);
          break;

        case JOB_TYPES.CONTRACT_INTERACTION:
          result = await this.processContractInteraction(data, job);
          break;

        case JOB_TYPES.TOKEN_TRANSFER:
          result = await this.processTokenTransfer(data, job);
          break;

        default:
          throw new Error(`Unknown job type: ${jobType}`);
      }

      await job.updateProgress({ stage: 'completed', result });
      await this.updateJobRecord(jobId, 'completed', result);

      return result;
    } catch (error) {
      console.error(`[BlockchainQueue] Job ${jobId} failed:`, error.message);
      
      // Check if error is retryable
      if (this.isRetryableError(error) && job.attemptsMade < job.opts.attempts) {
        await job.updateProgress({ 
          stage: 'retrying', 
          attempt: job.attemptsMade + 1, 
          error: error.message 
        });
        await this.updateJobRecord(jobId, 'retrying', { error: error.message });
        throw error; // Let BullMQ handle retry
      }

      // Non-retryable or max retries reached
      await this.updateJobRecord(jobId, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Check if an error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    const errorCode = error.code || error.reason;
    const errorMessage = error.message?.toLowerCase() || '';

    // Check error codes
    if (errorCode && RETRYABLE_ERRORS.includes(errorCode)) {
      return true;
    }

    // Check error messages for common retryable conditions
    const retryableMessages = [
      'network error',
      'timeout',
      'rate limit',
      'too many requests',
      'service unavailable',
      'gateway timeout',
      'connection reset',
      'nonce too low',
      'replacement transaction underpriced',
      'insufficient funds for gas',
    ];

    return retryableMessages.some(msg => errorMessage.includes(msg));
  }

  // ============================================
  // Job Processors
  // ============================================

  /**
   * Process escrow release
   */
  async processEscrowRelease(data, job) {
    const { invoiceId, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing escrow contract' });

    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    const bytes32InvoiceId = this.uuidToBytes32(invoiceId);

    await job.updateProgress({ stage: 'submitting', message: 'Submitting release transaction' });

    const tx = await escrowContract.confirmRelease(bytes32InvoiceId, {
      gasLimit: 500000,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    // Update database
    await pool.query(
      'UPDATE invoices SET escrow_status = $1, release_tx_hash = $2, updated_at = NOW() WHERE invoice_id = $3',
      ['released', tx.hash, invoiceId]
    );

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      invoiceId,
    };
  }

  /**
   * Process escrow dispute
   */
  async processEscrowDispute(data, job) {
    const { invoiceId, reason, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing escrow contract' });

    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    const bytes32InvoiceId = this.uuidToBytes32(invoiceId);

    await job.updateProgress({ stage: 'submitting', message: 'Submitting dispute transaction' });

    const tx = await escrowContract.raiseDispute(bytes32InvoiceId, {
      gasLimit: 500000,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    // Update database
    await pool.query(
      'UPDATE invoices SET escrow_status = $1, dispute_reason = $2, dispute_tx_hash = $3, updated_at = NOW() WHERE invoice_id = $4',
      ['disputed', reason, tx.hash, invoiceId]
    );

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      invoiceId,
    };
  }

  /**
   * Process escrow deposit
   */
  async processEscrowDeposit(data, job) {
    const { invoiceId, amount, tokenAddress, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing escrow contract' });

    const signer = getSigner();
    const escrowContract = new ethers.Contract(
      contractAddresses.escrowContract,
      EscrowContractArtifact.abi,
      signer
    );

    const bytes32InvoiceId = this.uuidToBytes32(invoiceId);

    // Handle token approval if not native currency
    if (tokenAddress && tokenAddress !== ethers.ZeroAddress) {
      await job.updateProgress({ stage: 'approving', message: 'Approving token spend' });
      
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function approve(address spender, uint256 amount) returns (bool)'],
        signer
      );
      
      const approveTx = await tokenContract.approve(contractAddresses.escrowContract, amount);
      await approveTx.wait();
    }

    await job.updateProgress({ stage: 'submitting', message: 'Submitting deposit transaction' });

    const overrides = tokenAddress === ethers.ZeroAddress ? { value: amount } : {};
    const tx = await escrowContract.deposit(bytes32InvoiceId, {
      ...overrides,
      gasLimit: 500000,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    // Update database
    await pool.query(
      'UPDATE invoices SET escrow_status = $1, deposit_tx_hash = $2, updated_at = NOW() WHERE invoice_id = $3',
      ['deposited', tx.hash, invoiceId]
    );

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      invoiceId,
    };
  }

  /**
   * Process streaming payment creation
   */
  async processStreamingCreate(data, job) {
    const { streamId, sellerAddress, buyerAddress, totalAmount, interval, numPayments, tokenAddress, description } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing streaming contract' });

    const streamingService = require('../services/streamingService');
    
    await job.updateProgress({ stage: 'submitting', message: 'Creating stream on-chain' });

    const result = await streamingService.createStreamOnChain(
      streamId,
      sellerAddress,
      buyerAddress,
      totalAmount,
      interval,
      numPayments,
      tokenAddress,
      description
    );

    return {
      success: true,
      txHash: result.txHash,
      streamId,
    };
  }

  /**
   * Process streaming approval
   */
  async processStreamingApprove(data, job) {
    const { streamId, amount, tokenAddress } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing streaming contract' });

    const streamingService = require('../services/streamingService');

    await job.updateProgress({ stage: 'submitting', message: 'Approving stream' });

    const result = await streamingService.approveStreamOnChain(streamId, amount, tokenAddress);

    return {
      success: true,
      txHash: result.txHash,
      streamId,
    };
  }

  /**
   * Process streaming payment release
   */
  async processStreamingRelease(data, job) {
    const { streamId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing streaming contract' });

    const streamingService = require('../services/streamingService');

    await job.updateProgress({ stage: 'submitting', message: 'Releasing payment' });

    const result = await streamingService.releasePaymentOnChain(streamId);

    // Update database
    const StreamingPayment = require('../models/StreamingPayment');
    await StreamingPayment.incrementReleased(streamId, result.amount, result.intervalsCompleted);

    return {
      success: true,
      txHash: result.txHash,
      streamId,
      amount: result.amount,
      intervalsCompleted: result.intervalsCompleted,
    };
  }

  /**
   * Process streaming pause
   */
  async processStreamingPause(data, job) {
    const { streamId } = data;

    await job.updateProgress({ stage: 'submitting', message: 'Pausing stream' });

    const streamingService = require('../services/streamingService');
    const result = await streamingService.pauseStreamOnChain(streamId);

    return {
      success: true,
      txHash: result.txHash,
      streamId,
    };
  }

  /**
   * Process streaming resume
   */
  async processStreamingResume(data, job) {
    const { streamId } = data;

    await job.updateProgress({ stage: 'submitting', message: 'Resuming stream' });

    const streamingService = require('../services/streamingService');
    const result = await streamingService.resumeStreamOnChain(streamId);

    return {
      success: true,
      txHash: result.txHash,
      streamId,
    };
  }

  /**
   * Process streaming cancel
   */
  async processStreamingCancel(data, job) {
    const { streamId } = data;

    await job.updateProgress({ stage: 'submitting', message: 'Cancelling stream' });

    const streamingService = require('../services/streamingService');
    const result = await streamingService.cancelStreamOnChain(streamId);

    return {
      success: true,
      txHash: result.txHash,
      streamId,
      remainingBalance: result.remainingBalance,
    };
  }

  /**
   * Process meta-transaction
   */
  async processMetaTransaction(data, job) {
    const { user, functionData, signature, contractAddress, contractAbi, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Validating meta-transaction' });

    const signer = getSigner();
    const contract = new ethers.Contract(contractAddress, contractAbi, signer);

    await job.updateProgress({ stage: 'submitting', message: 'Executing meta-transaction' });

    const tx = await contract.executeMetaTx(user, functionData, signature, {
      gasLimit: 500000,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      user,
    };
  }

  /**
   * Process generic contract interaction
   */
  async processContractInteraction(data, job) {
    const { contractAddress, contractAbi, method, args, overrides, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing contract' });

    const signer = getSigner();
    const contract = new ethers.Contract(contractAddress, contractAbi, signer);

    await job.updateProgress({ stage: 'submitting', message: `Calling ${method}` });

    const tx = await contract[method](...args, {
      gasLimit: overrides?.gasLimit || 500000,
      value: overrides?.value || 0,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      method,
    };
  }

  /**
   * Process token transfer
   */
  async processTokenTransfer(data, job) {
    const { tokenAddress, to, amount, userId } = data;

    await job.updateProgress({ stage: 'preparing', message: 'Initializing token contract' });

    const signer = getSigner();
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function transfer(address to, uint256 amount) returns (bool)'],
      signer
    );

    await job.updateProgress({ stage: 'submitting', message: 'Transferring tokens' });

    const tx = await tokenContract.transfer(to, amount, {
      gasLimit: 100000,
    });

    await job.updateProgress({ stage: 'confirming', message: 'Waiting for confirmation', txHash: tx.hash });

    const receipt = await tx.wait();

    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      to,
      amount: amount.toString(),
    };
  }

  /**
   * Convert UUID to bytes32
   * @param {string} uuid - UUID string
   * @returns {string} bytes32 representation
   */
  uuidToBytes32(uuid) {
    const hex = '0x' + uuid.replace(/-/g, '');
    return ethers.zeroPadValue(hex, 32);
  }

  /**
   * Gracefully shutdown the queue
   */
  async shutdown() {
    console.log('[BlockchainQueue] Shutting down...');

    if (this.worker) {
      await this.worker.close();
    }

    if (this.queueEvents) {
      await this.queueEvents.close();
    }

    if (this.queue) {
      await this.queue.close();
    }

    if (this.connection) {
      await this.connection.quit();
    }

    this.initialized = false;
    console.log('[BlockchainQueue] Shutdown complete');
  }
}

// Export singleton instance
const blockchainQueue = new BlockchainQueue();

module.exports = {
  blockchainQueue,
  JOB_TYPES,
  QUEUE_NAME,
};
