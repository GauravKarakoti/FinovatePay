import axios from 'axios';

const API_BASE_URL = import.meta.env.REACT_APP_API_URL || 'http://localhost:3000/api';

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

export const updateInvoiceStatus = (invoiceId, status, tx_hash) => {
    // Note: The second argument is the status, e.g., 'deposited' or 'released'
    return api.post(`/invoices/${invoiceId}/status`, { status, tx_hash });
};

export default api;