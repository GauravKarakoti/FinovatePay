import api from './api';

// Deposit funds from escrow to yield pool (admin only)
export const depositToYieldPool = (invoiceId) => {
  return api.post(`/yield/deposit/${invoiceId}`);
};

// Withdraw funds from yield pool back to escrow (admin only)
export const withdrawFromYieldPool = (invoiceId) => {
  return api.post(`/yield/withdraw/${invoiceId}`);
};

// Claim yield for an escrow (admin only)
export const claimYieldAPI = (invoiceId, sellerAddress) => {
  return api.post(`/yield/claim/${invoiceId}`, { sellerAddress });
};

// Get yield information for an invoice
export const getYieldInfo = (invoiceId) => {
  return api.get(`/yield/info/${invoiceId}`);
};

// Get global yield pool statistics (admin only)
export const getYieldPoolStats = () => {
  return api.get('/yield/stats');
};

// Get all escrows in yield pool (admin only)
export const getYieldPoolEscrows = () => {
  return api.get('/yield/escrows');
};
