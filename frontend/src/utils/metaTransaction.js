import { ethers } from 'ethers';

// Get forwarder address from environment
const FORWARDER_ADDRESS = import.meta.env.VITE_FORWARDER_ADDRESS;
const GASLESS_ENABLED = import.meta.env.VITE_GASLESS_ENABLED === 'true';

// EIP-712 Domain for MinimalForwarder
const getDomain = (chainId) => ({
  name: 'MinimalForwarder',
  version: '0.0.1',
  chainId: chainId,
  verifyingContract: FORWARDER_ADDRESS,
});

// EIP-712 Types for ForwardRequest
const ForwardRequestType = {
  ForwardRequest: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'gas', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
};

/**
 * Fetch current nonce for an address from the forwarder
 * @param {string} address - User address
 * @returns {Promise<string>} Current nonce
 */
export async function fetchNonce(address) {
  try {
    const response = await fetch(`/api/meta-tx/nonce/${address}`);
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch nonce');
    }
    
    return data.nonce;
  } catch (error) {
    console.error('Error fetching nonce:', error);
    throw error;
  }
}

/**
 * Build and sign a meta-transaction
 * @param {Object} signer - ethers.js Signer
 * @param {Object} targetContract - Contract instance
 * @param {string} functionName - Function to call
 * @param {Array} args - Function arguments
 * @param {number} gasLimit - Gas limit (optional, default 500000)
 * @returns {Promise<Object>} { request, signature }
 */
export async function buildMetaTransaction(
  signer,
  targetContract,
  functionName,
  args,
  gasLimit = 500000
) {
  try {
    // Get user address
    const from = await signer.getAddress();
    
    // Get current nonce
    const nonce = await fetchNonce(from);
    
    // Get chain ID
    const network = await signer.provider.getNetwork();
    const chainId = network.chainId;
    
    // Encode function call
    const data = targetContract.interface.encodeFunctionData(functionName, args);
    
    // Build ForwardRequest
    const request = {
      from,
      to: targetContract.address,
      value: '0',
      gas: gasLimit.toString(),
      nonce: nonce.toString(),
      data,
    };
    
    // Sign with EIP-712
    const signature = await signer._signTypedData(
      getDomain(chainId),
      ForwardRequestType,
      request
    );
    
    return { request, signature };
  } catch (error) {
    console.error('Error building meta-transaction:', error);
    throw error;
  }
}

/**
 * Submit a signed meta-transaction to the relayer
 * @param {Object} request - ForwardRequest object
 * @param {string} signature - EIP-712 signature
 * @returns {Promise<Object>} Transaction result
 */
export async function submitMetaTransaction(request, signature) {
  try {
    const response = await fetch('/api/meta-tx/submit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ request, signature }),
    });

    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Transaction failed');
    }
    
    return data;
  } catch (error) {
    console.error('Error submitting meta-transaction:', error);
    throw error;
  }
}

/**
 * Execute a gasless transaction with automatic nonce recovery
 * @param {Object} signer - ethers.js Signer
 * @param {Object} targetContract - Contract instance
 * @param {string} functionName - Function to call
 * @param {Array} args - Function arguments
 * @param {number} gasLimit - Gas limit (optional)
 * @returns {Promise<Object>} Transaction result
 */
export async function executeGaslessTransaction(
  signer,
  targetContract,
  functionName,
  args,
  gasLimit = 500000
) {
  try {
    // Build and sign meta-transaction
    const { request, signature } = await buildMetaTransaction(
      signer,
      targetContract,
      functionName,
      args,
      gasLimit
    );
    
    // Submit to relayer
    const result = await submitMetaTransaction(request, signature);
    
    return result;
  } catch (error) {
    // Handle invalid nonce error with automatic retry
    if (error.message.includes('Invalid nonce') || error.message.includes('nonce')) {
      console.log('Nonce mismatch detected, retrying with fresh nonce...');
      
      // Retry once with fresh nonce
      const { request, signature } = await buildMetaTransaction(
        signer,
        targetContract,
        functionName,
        args,
        gasLimit
      );
      
      return await submitMetaTransaction(request, signature);
    }
    
    throw error;
  }
}

/**
 * Get gas cost statistics for the current user
 * @param {Object} options - Query options (startDate, endDate, limit)
 * @returns {Promise<Object>} Gas cost data
 */
export async function getGasCosts(options = {}) {
  try {
    const params = new URLSearchParams();
    if (options.startDate) params.append('startDate', options.startDate);
    if (options.endDate) params.append('endDate', options.endDate);
    if (options.limit) params.append('limit', options.limit);
    
    const response = await fetch(`/api/meta-tx/gas-costs?${params}`, {
      credentials: 'include',
    });

    
    const data = await response.json();
    
    if (!data.success) {
      throw new Error(data.error || 'Failed to fetch gas costs');
    }
    
    return data;
  } catch (error) {
    console.error('Error fetching gas costs:', error);
    throw error;
  }
}

/**
 * Check if gasless transactions are enabled
 * @returns {boolean} True if enabled
 */
export function isGaslessEnabled() {
  return GASLESS_ENABLED && FORWARDER_ADDRESS;
}

/**
 * Get user-friendly error message
 * @param {Error} error - Error object
 * @returns {string} User-friendly message
 */
export function formatMetaTxError(error) {
  const message = error.message || error.toString();
  
  const errorMap = {
    'Invalid signature': 'Transaction signature is invalid. Please try signing again.',
    'Invalid nonce': 'Transaction nonce is outdated. Refreshing and retrying...',
    'Rate limit exceeded': 'Too many requests. Please wait a moment and try again.',
    'Daily gas limit exceeded': 'You have reached your daily transaction limit. Limit resets at midnight UTC.',
    'Account frozen': 'Your account is frozen. Please contact support.',
    'KYC not verified': 'Please complete KYC verification before making transactions.',
    'Relayer temporarily unavailable': 'Gasless transactions are temporarily unavailable. Try using direct transaction mode.',
    'Authentication required': 'Please log in to use gasless transactions.',
  };
  
  for (const [key, value] of Object.entries(errorMap)) {
    if (message.includes(key)) {
      return value;
    }
  }
  
  return 'Transaction failed. Please try again or use direct transaction mode.';
}

export { FORWARDER_ADDRESS, GASLESS_ENABLED };
