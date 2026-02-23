const { ethers } = require('ethers');
const { getProvider, getSigner } = require('../config/blockchain');
const MinimalForwarderABI = require('../../deployed/MinimalForwarder.json').abi;
const contractAddresses = require('../../deployed/contract-addresses.json');

class RelayerService {
  constructor() {
    this.provider = getProvider();
    this.signer = getSigner();
    this.forwarder = new ethers.Contract(
      contractAddresses.MinimalForwarder,
      MinimalForwarderABI,
      this.signer
    );
    this.rateLimiter = new Map(); // user -> { count, resetTime }
    this.rateLimit = parseInt(process.env.GASLESS_RATE_LIMIT || '10');
    this.rateLimitWindow = 60 * 1000; // 1 minute
  }

  /**
   * Submit a meta-transaction to the blockchain
   * @param {Object} request - ForwardRequest object
   * @param {string} signature - EIP-712 signature
   * @param {number} userId - User ID for tracking
   * @returns {Promise<Object>} Transaction result
   */
  async submitMetaTransaction(request, signature, userId) {
    try {
      // 1. Validate signature format
      if (!signature || !signature.startsWith('0x') || signature.length !== 132) {
        throw new Error('Invalid signature format');
      }

      // 2. Check rate limits
      this.checkRateLimit(request.from);

      // 3. Verify signature matches request.from
      const isValid = await this.forwarder.verify(request, signature);
      if (!isValid) {
        throw new Error('Signature verification failed');
      }

      // 4. Submit to forwarder with retry logic
      const tx = await this.submitWithRetry(request, signature);
      
      // 5. Wait for confirmation
      const receipt = await tx.wait();

      // 6. Record gas costs
      await this.recordGasCost(receipt.transactionHash, userId, receipt);

      return {
        success: true,
        txHash: receipt.transactionHash,
        gasUsed: receipt.gasUsed.toString()
      };
    } catch (error) {
      console.error('Meta-transaction submission error:', error);
      return {
        success: false,
        error: this.formatError(error)
      };
    }
  }

  /**
   * Get current nonce for an address
   * @param {string} address - User address
   * @returns {Promise<string>} Current nonce
   */
  async getNonce(address) {
    try {
      const nonce = await this.forwarder.getNonce(address);
      return nonce.toString();
    } catch (error) {
      console.error('Error fetching nonce:', error);
      throw error;
    }
  }

  /**
   * Submit transaction with retry logic
   * @param {Object} request - ForwardRequest
   * @param {string} signature - Signature
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<Object>} Transaction object
   */
  async submitWithRetry(request, signature, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const tx = await this.forwarder.execute(request, signature, {
          gasLimit: 500000 // Set appropriate gas limit
        });
        return tx;
      } catch (error) {
        if (attempt === maxRetries) throw error;
        
        if (this.isRetryableError(error)) {
          const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
          console.log(`Retry attempt ${attempt} after ${delay}ms`);
          await this.sleep(delay);
          continue;
        }
        
        throw error; // Non-retryable error
      }
    }
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error object
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    const retryableCodes = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'SERVER_ERROR',
      'NONCE_EXPIRED',
      'REPLACEMENT_UNDERPRICED'
    ];
    return retryableCodes.includes(error.code);
  }

  /**
   * Check rate limit for user
   * @param {string} address - User address
   * @throws {Error} If rate limit exceeded
   */
  checkRateLimit(address) {
    const now = Date.now();
    const userLimit = this.rateLimiter.get(address);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or initialize
      this.rateLimiter.set(address, {
        count: 1,
        resetTime: now + this.rateLimitWindow
      });
      return;
    }

    if (userLimit.count >= this.rateLimit) {
      const waitTime = Math.ceil((userLimit.resetTime - now) / 1000);
      throw new Error(`Rate limit exceeded. Try again in ${waitTime} seconds`);
    }

    userLimit.count++;
  }

  /**
   * Record gas costs in database
   * @param {string} txHash - Transaction hash
   * @param {number} userId - User ID
   * @param {Object} receipt - Transaction receipt
   */
  async recordGasCost(txHash, userId, receipt) {
    try {
      const gasUsed = receipt.gasUsed.toBigInt();
      const gasPrice = receipt.effectiveGasPrice.toBigInt();
      const gasCostWei = gasUsed * gasPrice;
      const gasCostMatic = Number(gasCostWei) / 1e18;

      // Get MATIC/USD price (simplified - in production use price oracle)
      const maticUsdPrice = 0.50; // Placeholder
      const gasCostUsd = gasCostMatic * maticUsdPrice;

      const pool = require('../config/database');
      await pool.query(
        `INSERT INTO meta_transactions 
         (user_id, tx_hash, from_address, to_address, gas_used, gas_price, gas_cost_matic, gas_cost_usd, status, confirmed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          userId,
          txHash,
          receipt.from,
          receipt.to,
          gasUsed.toString(),
          gasPrice.toString(),
          gasCostMatic,
          gasCostUsd,
          'confirmed'
        ]
      );

      console.log(`Gas cost recorded: ${gasCostMatic} MATIC ($${gasCostUsd.toFixed(4)})`);
    } catch (error) {
      console.error('Error recording gas cost:', error);
      // Don't throw - gas recording failure shouldn't fail the transaction
    }
  }

  /**
   * Format error for user-friendly response
   * @param {Error} error - Error object
   * @returns {string} Formatted error message
   */
  formatError(error) {
    if (error.message.includes('Rate limit')) {
      return error.message;
    }
    if (error.message.includes('Invalid signature')) {
      return 'Invalid signature format or structure';
    }
    if (error.message.includes('Signature verification failed')) {
      return 'Signature does not match claimed sender';
    }
    if (error.message.includes('insufficient funds')) {
      return 'Relayer temporarily unavailable';
    }
    if (error.reason) {
      return error.reason;
    }
    return 'Transaction failed. Please try again.';
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new RelayerService();
