import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL;
console.log("API Base URL:", API_BASE_URL);

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle API errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API
export const login = (email, password) => {
  return api.post('/auth/login', { email, password });
};

export const register = (userData) => {
  return api.post('/auth/register', userData);
};

// Invoice API
export const createInvoice = (invoiceData) => {
  return api.post('/invoices', invoiceData);
};

export const getSellerInvoices = () => {
  return api.get('/invoices/seller');
};

export const getBuyerInvoices = () => {
  console.log("Getting Invoice");
  return api.get('/invoices/buyer');
};

export const getInvoice = (invoiceId) => {
  return api.get(`/invoices/${invoiceId}`);
};

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

export const getMarketPrices = (crop, state) => {
    return api.get('/market/prices', { params: { crop, state } });
};

export const getSellerLots = () => {
  return api.get('/produce/lots/seller');
};

export const getProduceTransactions = (lotId) => {
  return api.get(`/produce/lots/${lotId}/transactions`);
};

// Payment API
export const depositToEscrow = (invoiceId, amount, seller_address) => {
  console.log('API call to deposit to escrow:', { invoiceId, amount, seller_address });
  return api.post('/payments/escrow/deposit', { invoiceId, amount, seller_address });
};

export const confirmRelease = (invoiceId) => {
  return api.post('/payments/escrow/release', { invoiceId });
};

export const raiseDispute = (invoiceId, reason) => {
  return api.post('/payments/escrow/dispute', { invoiceId, reason });
};

// KYC API
export const verifyKYC = (userData) => {
  return api.post('/kyc/verify', userData);
};

// Admin API
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
  // Using PUT is a common REST convention for updating a resource
  return api.put(`/admin/users/${userId}/role`, { role });
};

export const updateInvoiceStatus = (invoiceId, status, tx_hash, dispute_reason = '') => {
    // Note: The second argument is the status, e.g., 'deposited' or 'released'
    return api.post(`/invoices/${invoiceId}/status`, { status, tx_hash, dispute_reason });
};

export const resolveDispute = async (invoiceId, sellerWins) => {
  const response = await api.post('/admin/resolve-dispute', { invoiceId, sellerWins });
  return response.data;
};

export default api;