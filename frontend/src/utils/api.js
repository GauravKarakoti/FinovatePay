import axios from 'axios';
import { toast } from 'sonner';
import { checkOnlineStatus } from './network';

const API_BASE_URL = import.meta.env.VITE_API_URL;
console.log('API Base URL:', API_BASE_URL);

// Navigation utility for programmatic navigation outside React components
let navigateFunction = null;

export const setNavigateFunction = (navigate) => {
  navigateFunction = navigate;
};

// Create axios instance with default config
// withCredentials: true ensures cookies are sent with requests
// API v1 base URL
export const api = axios.create({
  baseURL: `${API_BASE_URL}/v1`,
  withCredentials: true,
});

// Raw axios instance without interceptors for logout requests
// This prevents recursive 401 loops when logout endpoint also returns 401
const rawAxios = axios.create({
  baseURL: `${API_BASE_URL}/v1`,
  withCredentials: true,
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

const getErrorMessage = (errorData, fallback) => {
  if (typeof errorData?.message === 'string') return errorData.message;
  if (typeof errorData?.error === 'string') return errorData.error;
  if (errorData?.error?.message) return errorData.error.message;
  return fallback;
};

// Handle API errors with comprehensive error handling

api.interceptors.response.use(
  (response) => {
    // Check for API version headers
    const apiVersion = response.headers['x-api-version'];
    const latestVersion = response.headers['x-api-latest-version'];
    const deprecation = response.headers['deprecation'];
    
    if (deprecation && process.env.NODE_ENV === 'development') {
      console.warn(`[API] Deprecation warning: This API version is deprecated. Latest version: ${latestVersion}`);
    }
    
    // Check for deprecation warning in response body
    if (response.data?.deprecationWarning) {
      console.warn(`[API] Deprecation Warning: ${response.data.deprecationWarning}`);
    }
    
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Handle network errors (no response from server)
    if (!error.response) {
      console.error('Network error: No response from server', error);

      // Check if it's a timeout error
      if (error.code === 'ECONNABORTED') {
        console.error('Request timeout');
        const message = 'Request timed out. Please try again.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isTimeout: true,
        });
      }

      // Check if user is offline using robust connectivity detection
      const isOnline = await checkOnlineStatus();
      if (!isOnline) {
        console.error('User is offline');
        const message = 'You are offline. Please check your internet connection.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isOffline: true,
        });
      }

      const message = 'Network error. Please check your connection and try again.';
      toast.error(message);
      return Promise.reject({
        ...error,
        message,
        isNetworkError: true,
      });
    }

    const status = error.response.status;
    const errorData = error.response.data;
    let message = '';

    // Handle specific HTTP status codes
    switch (status) {
      case 400:
        console.error('Bad request:', errorData);
        message =
          errorData?.message || errorData?.error || 'Invalid request. Please check your input.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isValidationError: true,
        });

      case 401:
        // Call backend logout to clear HttpOnly cookie using raw axios (without interceptor)
        // to prevent recursive 401 loops if logout endpoint also returns 401
        try {
          await rawAxios.post('/auth/logout');
        } catch (logoutError) {
          console.error('Logout request failed:', logoutError);
        }
        
        // Clear all authentication tokens and user data from localStorage
        localStorage.removeItem('token');

        // Clear user data from localStorage
        localStorage.removeItem('user');

        // Use React Router navigation if available, fallback to hard redirect
        if (navigateFunction) {
          navigateFunction('/login', { replace: true });
        } else {
          window.location.href = '/login';
        }
        message = 'Session expired. Please log in again.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isAuthError: true,
        });

      case 403:
        console.error('Forbidden:', errorData);
        message =
          errorData?.message ||
          errorData?.error ||
          'You do not have permission to perform this action.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isForbidden: true,
        });

      case 404:
        console.error('Not found:', errorData);
        message = errorData?.message || errorData?.error || 'The requested resource was not found.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isNotFound: true,
        });

      case 409:
        console.error('Conflict:', errorData);
        message =
          errorData?.message ||
          errorData?.error ||
          'A conflict occurred. The resource may already exist.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isConflict: true,
        });

      case 422:
        console.error('Validation error:', errorData);
        message =
          errorData?.message || errorData?.error || 'Validation failed. Please check your input.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isValidationError: true,
          validationErrors: errorData?.errors,
        });

      case 429:
        console.error('Rate limited:', errorData);
        message =
          errorData?.message || errorData?.error || 'Too many requests. Please try again later.';
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isRateLimited: true,
        });

      case 500:
      case 502:
      case 503:
      case 504:
        console.error('Server error:', status, errorData);

        // Retry logic for transient server errors (only for GET requests and not already retried)
        if (originalRequest.method === 'get' && !originalRequest._retry) {
          originalRequest._retry = true;
          console.log(`Retrying request after ${status} error...`);

          // Wait 1 second before retrying
          await new Promise((resolve) => setTimeout(resolve, 1000));

          return api(originalRequest);
        }

        message = getErrorMessage(errorData, 'Server error. Please try again later.');
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          isServerError: true,
        });

      default:
        console.error(`HTTP ${status} error:`, errorData);
        message =
          errorData?.message ||
          errorData?.error ||
          `An error occurred (HTTP ${status}). Please try again.`;
        toast.error(message);
        return Promise.reject({
          ...error,
          message,
          status,
        });
    }
  }
);

// --- Fixed Functions (Now using 'api' instance) ---

export const tokenizeInvoice = (invoiceId, faceValue, maturityDate) => {
  // Removed raw axios and manual headers
  return api.post('/financing/tokenize', { invoiceId, faceValue, maturityDate });
};

export const getMarketplaceListings = () => {
  return api.get('/financing/marketplace');
};

// --- AMM Secondary Market API ---
export const getAMMPairs = (params) => {
  return api.get('/amm/pairs', { params });
};

export const getAMMPairByTokenId = (tokenId) => {
  return api.get(`/amm/pairs/token/${tokenId}`);
};

export const addAMMLiquidity = (payload) => {
  return api.post('/amm/liquidity/add', payload);
};

export const removeAMMLiquidity = (payload) => {
  return api.post('/amm/liquidity/remove', payload);
};

export const executeAMMSwap = (payload) => {
  return api.post('/amm/swap', payload);
};

export const getAMMPositions = () => {
  return api.get('/amm/positions/me');
};

export const getAMMTrades = (params) => {
  return api.get('/amm/trades', { params });
};

// --- Auth API ---
export const login = (email, password) => {
  return api.post('/auth/login', { email, password });
};

export const register = (userData) => {
  return api.post('/auth/register', userData);
};

export const logout = async () => {
  try {
    // Call logout endpoint to clear server-side sessions/cookies
    await api.post('/auth/logout');
  } catch (error) {
    // Continue with local cleanup even if server logout fails
    console.error('Server logout failed:', error);
  } finally {
    // Always clear ALL authentication data from localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    
    console.log('[AUTH] User logged out - all tokens cleared from localStorage');
  }
};

export const updateCurrentUserRole = (role) => {
  return api.put('/auth/role', { role });
};

export const forgotPassword = (email) => {
  return api.post('/auth/forgot-password', { email });
};

export const resetPassword = (token, newPassword) => {
  return api.post('/auth/reset-password', { token, newPassword });
};

export const changePassword = (currentPassword, newPassword) => {
  return api.put('/auth/change-password', { currentPassword, newPassword });
};

// --- Invoice API ---
export const createInvoice = (invoiceData) => {
  return api.post('/invoices', invoiceData);
};

export const getSellerInvoices = () => {
  return api.get('/invoices/seller');
};

export const getBuyerInvoices = () => {
  return api.get('/invoices/buyer');
};

export const getInvoice = (invoiceId) => {
  return api.get(`/invoices/${invoiceId}`);
};

// --- Produce API ---
export const createProduceLot = (produceData) => {
  return api.post('/produce/lots', produceData);
};

export const getProduceLot = (lotId) => {
  return api.get(`/produce/lots/${lotId}`);
};

export const createFiatRampLink = (data) => {
  return api.post('/fiat-ramp/create-link', data);
};

export const transferProduce = (transferData) => {
  return api.post('/produce/transfer', transferData);
};

export const getProducerLots = () => {
  return api.get('/produce/lots/producer');
};

export const getAvailableLots = () => {
  return api.get('/produce/lots/available');
};

export const updateLotLocation = (data) => api.post('/shipment/location', data);

// --- Quotation API ---
export const createQuotation = (quotationData) => {
  return api.post('/quotations', quotationData);
};

export const getQuotations = () => {
  return api.get('/quotations');
};

export const getPendingBuyerApprovals = () => {
  return api.get('/quotations/pending-for-buyer');
};

export const sellerApproveQuotation = (quotationId) => {
  return api.post(`/quotations/${quotationId}/seller-approve`);
};

export const buyerApproveQuotation = (quotationId) => {
  return api.post(`/quotations/${quotationId}/buyer-approve`);
};

export const rejectQuotation = (quotationId) => {
  return api.post(`/quotations/${quotationId}/reject`);
};

// --- Market API ---
export const getMarketPrices = (crop, state) => {
  return api.get('/market/prices', { params: { crop, state } });
};

export const getSellerLots = () => {
  return api.get('/produce/lots/seller');
};

export const getProduceTransactions = (lotId) => {
  return api.get(`/produce/lots/${lotId}/transactions`);
};

// --- Payment API ---
export const depositToEscrow = (invoiceId, amount, sellerAddress) => {
  return api.post('/payments/escrow/deposit', { invoiceId, amount, sellerAddress });
};

export const confirmRelease = (invoiceId) => {
  return api.post('/payments/escrow/release', { invoiceId });
};

export const raiseDispute = (invoiceId, reason) => {
  return api.post('/payments/escrow/dispute', { invoiceId, reason });
};

// --- Multi-Signature Escrow API ---

// Add multi-signature approval for an escrow
export const approveMultiSig = (invoiceId) => {
  return api.post(`/escrow/${invoiceId}/approve`);
};

// Get multi-signature approval status for an escrow
export const getMultiSigApprovals = (invoiceId) => {
  return api.get(`/escrow/${invoiceId}/approvals`);
};

// Get full escrow status including multi-sig details
export const getEscrowStatus = (invoiceId) => {
  return api.get(`/escrow/${invoiceId}/status`);
};

// Create a multi-party escrow for an invoice
export const createMultiPartyEscrow = (invoiceId, durationSeconds) => {
  return api.post('/escrow/multi-party', { invoiceId, durationSeconds });
};

// --- High-Value Transaction Multi-Sig API ---

// Check if a transaction requires multi-sig
export const checkHighValueRequired = (invoiceId) => {
  return api.get(`/multi-sig/check-require/${invoiceId}`);
};

// Get high-value transaction status
export const getHighValueStatus = (invoiceId) => {
  return api.get(`/multi-sig/status/${invoiceId}`);
};

// Add approval for high-value transaction
export const approveHighValue = (invoiceId) => {
  return api.post(`/multi-sig/approve/${invoiceId}`);
};

// Get all high-value transactions
export const getHighValueTransactions = (status) => {
  return api.get('/multi-sig/transactions', { params: { status } });
};

// Get multi-sig configuration
export const getMultiSigConfig = () => {
  return api.get('/multi-sig/config');
};

// Update multi-sig configuration (admin)
export const updateMultiSigConfig = (key, value) => {
  return api.put('/multi-sig/config', { key, value });
};

// --- KYC API ---
export const verifyKYC = (userData) => {
  return api.post('/kyc/verify', userData);
};

export const getKYCStatus = () => {
  return api.get('/kyc/status');
};

// --- Admin API ---
export const getUsers = () => {
  return api.get('/admin/users');
};

export const getInvoices = () => {
  return api.get('/admin/invoices');
};

export const freezeAccount = (userId) => {
  return api.post(`/admin/users/${userId}/freeze`);
};

export const unfreezeAccount = (userId) => {
  return api.post(`/admin/users/${userId}/unfreeze`);
};

export const checkCompliance = (walletAddress) => {
  return api.post('/admin/compliance/check', { walletAddress });
};

export const updateUserRole = (userId, role) => {
  return api.put(`/admin/users/${userId}/role`, { role });
};

export const updateInvoiceStatus = (invoiceId, status, txHash, disputeReason = '') => {
  return api.post(`/invoices/${invoiceId}/status`, { 
    status, 
    tx_hash: txHash, 
    dispute_reason: disputeReason 
  });
};

export const resolveDispute = async (invoiceId, sellerWins) => {
  const response = await api.post('/admin/resolve-dispute', { invoiceId, sellerWins });
  return response.data;
};

// --- Fraud Detection API ---
export const analyzeFraudRisk = (payload) => {
  return api.post('/fraud-detection/analyze', payload);
};

export const getFraudAlerts = (params = {}) => {
  return api.get('/fraud-detection/alerts', { params });
};

export const getFraudSummary = () => {
  return api.get('/fraud-detection/summary');
};

export const updateFraudAlertStatus = (alertId, status, resolutionNote) => {
  return api.patch(`/fraud-detection/alerts/${alertId}/status`, { status, resolutionNote });
};

// --- Streaming Payments API ---

// Create a new subscription stream (seller)
export const createStream = (streamData) => {
  return api.post('/streaming', streamData);
};

// Get all streams for current user
export const getMyStreams = () => {
  return api.get('/streaming');
};

// Get streams where user is seller
export const getSellerStreams = () => {
  return api.get('/streaming/seller');
};

// Get streams where user is buyer
export const getBuyerStreams = () => {
  return api.get('/streaming/buyer');
};

// Get stream details
export const getStream = (streamId) => {
  return api.get(`/streaming/${streamId}`);
};

// Approve and fund a stream (buyer)
export const approveStream = (streamId, amount) => {
  return api.post(`/streaming/${streamId}/approve`, { amount });
};

// Release payment for completed interval
export const releasePayment = (streamId) => {
  return api.post(`/streaming/${streamId}/release`);
};

// Pause a stream (buyer)
export const pauseStream = (streamId) => {
  return api.post(`/streaming/${streamId}/pause`);
};

// Resume a paused stream (buyer)
export const resumeStream = (streamId) => {
  return api.post(`/streaming/${streamId}/resume`);
};

// Cancel a stream (seller or buyer)
export const cancelStream = (streamId) => {
  return api.post(`/streaming/${streamId}/cancel`);
};

// --- Auction API ---

// Create a new auction
export const createAuction = (auctionData) => {
  return api.post('/auctions', auctionData);
};

// Get all active auctions
export const getAuctions = (params) => {
  return api.get('/auctions', { params });
};

// Get auctions for current seller
export const getSellerAuctions = () => {
  return api.get('/auctions/seller');
};

// Get auctions the user has bid on
export const getBidderAuctions = () => {
  return api.get('/auctions/bidder');
};

// Get auction statistics
export const getAuctionStats = () => {
  return api.get('/auctions/stats');
};

// Get auction details
export const getAuction = (auctionId) => {
  return api.get(`/auctions/${auctionId}`);
};

// Get bids for an auction
export const getAuctionBids = (auctionId) => {
  return api.get(`/auctions/${auctionId}/bids`);
};

// Start an auction
export const startAuction = (auctionId) => {
  return api.post(`/auctions/${auctionId}/start`);
};

// Place a bid on an auction
export const placeBid = (auctionId, bidData) => {
  return api.post(`/auctions/${auctionId}/bid`, bidData);
};

// End an auction
export const endAuction = (auctionId) => {
  return api.post(`/auctions/${auctionId}/end`);
};

// Settle an auction
export const settleAuction = (auctionId) => {
  return api.post(`/auctions/${auctionId}/settle`);
};

// Cancel an auction
export const cancelAuction = (auctionId) => {
  return api.post(`/auctions/${auctionId}/cancel`);
};

// --- Analytics API ---
export const getAnalyticsOverview = () => {
  return api.get('/analytics/overview');
};

export const getPaymentAnalytics = () => {
  return api.get('/analytics/payments');
};

export const getFinancingAnalytics = () => {
  return api.get('/analytics/financing');
};

export const getInvoiceRisk = (invoiceId) => {
  return api.get(`/analytics/risk/${invoiceId}`);
};

// Alias for getInvoiceRisk used by AnalyticsDashboard
export const getRiskScore = getInvoiceRisk;

// --- Insurance API ---

// Get insurance configuration
export const getInsuranceConfig = () => {
  return api.get('/insurance/config');
};

// Calculate premium for given coverage and duration
export const calculateInsurancePremium = (coverageAmount, durationSeconds) => {
  return api.get('/insurance/calculate-premium', { params: { coverageAmount, durationSeconds } });
};

// Purchase insurance for an escrow
export const purchaseInsurance = (data) => {
  return api.post('/insurance/purchase', data);
};

// Get user's insurance policies
export const getInsurancePolicies = () => {
  return api.get('/insurance/policies');
};

// Get specific policy details
export const getInsurancePolicy = (policyId) => {
  return api.get(`/insurance/policy/${policyId}`);
};

// Get insurance policies for an invoice
export const getInvoiceInsurance = (invoiceId) => {
  return api.get(`/insurance/invoice/${invoiceId}`);
};

// File a claim on an insurance policy
export const fileInsuranceClaim = (data) => {
  return api.post('/insurance/claim', data);
};

// Approve a claim (admin only)
export const approveInsuranceClaim = (data) => {
  return api.post('/insurance/approve-claim', data);
};

// Get insurance statistics (admin only)
export const getInsuranceStats = () => {
  return api.get('/insurance/stats');
};

// Get all pending claims (admin only)
export const getPendingClaims = () => {
  return api.get('/insurance/claims');
};

// --- Governance API ---

// Get all proposals
export const getProposals = (params) => {
  return api.get('/governance/proposals', { params });
};

// Get a specific proposal
export const getProposal = (proposalId) => {
  return api.get(`/governance/proposals/${proposalId}`);
};

// Create a new proposal
export const createProposal = (proposalData) => {
  return api.post('/governance/proposals', proposalData);
};

// Cast a vote on a proposal
export const castVote = (voteData) => {
  return api.post('/governance/vote', voteData);
};

// Get governance parameters
export const getGovernanceParameters = () => {
  return api.get('/governance/parameters');
};

// Update a governance parameter (admin)
export const updateGovernanceParameter = (name, value) => {
  return api.put(`/governance/parameters/${name}`, { value });
};

// Get voting power for a wallet
export const getVotingPower = (wallet) => {
  return api.get(`/governance/voting-power/${wallet}`);
};

// Get delegation info
export const getDelegation = (wallet) => {
  return api.get(`/governance/delegation/${wallet}`);
};

// Get governance statistics
export const getGovernanceStats = () => {
  return api.get('/governance/stats');
};

// Execute a parameter change
export const executeParameterChange = (parameterName) => {
  return api.post('/governance/execute', { parameterName });
};

// --- Treasury API ---
export const getTreasuryBalance = (token) => {
  return api.get('/treasury/balance', { params: { token } });
};

export const withdrawFromTreasury = (token, to, amount) => {
  return api.post('/treasury/withdraw', { token, to, amount });
};

export const getTreasuryTransactions = (params) => {
  return api.get('/treasury/transactions', { params });
};

export const getTreasuryReports = (params) => {
  return api.get('/treasury/reports', { params });
};

// --- Staking API ---
export const stakeTokens = ({ tokenAddress, tokenId, amount, lockDurationSeconds, apyBP }) => {
  return api.post('/staking/stake', { tokenAddress, tokenId, amount, lockDurationSeconds, apyBP });
};

export const unstakeTokens = (stakeId) => {
  return api.post('/staking/unstake', { stakeId });
};

export const getStakingRewards = () => {
  return api.get('/staking/rewards');
};

export const claimStakingRewards = (stakeId) => {
  return api.post('/staking/rewards/claim', { stakeId });
};

// --- Multi-Party Conditional Escrow (milestone-based) ---

/**
 * Create a new multi-party conditional escrow with milestones.
 * @param {object} payload - { invoiceId, title, totalAmount, currency, durationSeconds, participants, milestones }
 */
export const createMultiPartyConditionalEscrow = (payload) =>
  api.post('/escrow/milestones', payload);

/**
 * Publish a draft escrow to the blockchain (status: draft → active).
 * @param {string} escrowId UUID of multi_party_escrows record
 * @param {object} [opts] - { tokenAddress, durationSeconds }
 */
export const activateMultiPartyEscrow = (escrowId, opts = {}) =>
  api.post(`/escrow/milestones/${escrowId}/activate`, opts);

/**
 * Add a participant to an existing multi-party escrow.
 * @param {string} escrowId
 * @param {{ walletAddress: string, role: string, userId?: string, onChain?: boolean }} participant
 */
export const addEscrowParticipant = (escrowId, participant) =>
  api.post(`/escrow/milestones/${escrowId}/participants`, participant);

/**
 * Add a milestone to an existing multi-party escrow.
 * @param {string} escrowId
 * @param {{ title: string, description?: string, amount: number, requiredApprovals?: number, onChain?: boolean }} milestone
 */
export const addEscrowMilestone = (escrowId, milestone) =>
  api.post(`/escrow/milestones/${escrowId}/milestones`, milestone);

/**
 * Approve a specific milestone.
 * @param {string} escrowId
 * @param {number|string} milestoneId  Primary key of escrow_milestones
 * @param {{ txHash?: string, blockNumber?: number }} [opts]
 */
export const approveMilestoneOnEscrow = (escrowId, milestoneId, opts = {}) =>
  api.post(`/escrow/milestones/${escrowId}/milestones/${milestoneId}/approve`, opts);

/**
 * Fetch full escrow details (header + participants + milestones with approvals).
 * @param {string} escrowId
 */
export const getMultiPartyEscrow = (escrowId) =>
  api.get(`/escrow/milestones/${escrowId}`);

/**
 * Fetch only the milestones and participants for an escrow.
 * @param {string} escrowId
 */
export const getEscrowMilestones = (escrowId) =>
  api.get(`/escrow/milestones/${escrowId}/milestones`);

/**
 * List all multi-party escrows created by the current user.
 * @param {string} [status] Optional status filter
 */
export const listMultiPartyEscrows = (status) =>
  api.get('/escrow/milestones', status ? { params: { status } } : undefined);

export default api;
