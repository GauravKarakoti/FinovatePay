import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL;
console.log("API Base URL:", API_BASE_URL);

// Navigation utility for programmatic navigation outside React components
let navigateFunction = null;

export const setNavigateFunction = (navigate) => {
  navigateFunction = navigate;
};

// Create axios instance with default config
// withCredentials: true ensures cookies are sent with requests
export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// Handle API errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear user data from localStorage
      localStorage.removeItem('user');
      // Use React Router navigation if available, fallback to hard redirect
      if (navigateFunction) {
        navigateFunction('/login', { replace: true });
      } else {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
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

// --- Auth API ---
export const login = (email, password) => {
  return api.post('auth/login', { email, password });
};

export const register = (userData) => {
  return api.post('auth/register', userData);
};

export const updateCurrentUserRole = (role) => {
  return api.put('auth/role', { role });
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
export const depositToEscrow = (invoiceId, amount, seller_address) => {
  return api.post('/payments/escrow/deposit', { invoiceId, amount, seller_address });
};

export const confirmRelease = (invoiceId) => {
  return api.post('/payments/escrow/release', { invoiceId });
};

export const raiseDispute = (invoiceId, reason) => {
  return api.post('/payments/escrow/dispute', { invoiceId, reason });
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

export const updateInvoiceStatus = (invoiceId, status, tx_hash, dispute_reason = '') => {
    return api.post(`/invoices/${invoiceId}/status`, { status, tx_hash, dispute_reason });
};

export const resolveDispute = async (invoiceId, sellerWins) => {
  const response = await api.post('/admin/resolve-dispute', { invoiceId, sellerWins });
  return response.data;
};

export default api;
