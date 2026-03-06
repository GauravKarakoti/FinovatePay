import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';

// Mock axios
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };
  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('API Utilities', () => {
  let mockAxiosCreate;
  let mockAxiosInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosCreate = axios.create;
    mockAxiosInstance = mockAxiosCreate();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('creates axios instance with correct base configuration', () => {
    // Re-import to trigger the axios.create call
    const { api } = require('../utils/api');
    
    expect(mockAxiosCreate).toHaveBeenCalled();
    const createConfig = mockAxiosCreate.mock.calls[0][0];
    
    expect(createConfig.withCredentials).toBe(true);
  });

  it('sets up request interceptor', () => {
    require('../utils/api');
    
    expect(mockAxiosInstance.interceptors.request.use).toHaveBeenCalled();
  });

  it('sets up response interceptor', () => {
    require('../utils/api');
    
    expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
  });
});

describe('API Functions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('exports login function', async () => {
    const { login } = require('../utils/api');
    expect(typeof login).toBe('function');
  });

  it('exports register function', async () => {
    const { register } = require('../utils/api');
    expect(typeof register).toBe('function');
  });

  it('exports invoice-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.createInvoice).toBe('function');
    expect(typeof api.getSellerInvoices).toBe('function');
    expect(typeof api.getBuyerInvoices).toBe('function');
    expect(typeof api.getInvoice).toBe('function');
    expect(typeof api.updateInvoiceStatus).toBe('function');
  });

  it('exports produce-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.createProduceLot).toBe('function');
    expect(typeof api.getProduceLot).toBe('function');
    expect(typeof api.getAvailableLots).toBe('function');
    expect(typeof api.getProducerLots).toBe('function');
  });

  it('exports quotation-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.createQuotation).toBe('function');
    expect(typeof api.getQuotations).toBe('function');
    expect(typeof api.sellerApproveQuotation).toBe('function');
    expect(typeof api.buyerApproveQuotation).toBe('function');
    expect(typeof api.rejectQuotation).toBe('function');
  });

  it('exports streaming-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.createStream).toBe('function');
    expect(typeof api.getMyStreams).toBe('function');
    expect(typeof api.getStream).toBe('function');
    expect(typeof api.approveStream).toBe('function');
    expect(typeof api.releasePayment).toBe('function');
    expect(typeof api.pauseStream).toBe('function');
    expect(typeof api.resumeStream).toBe('function');
    expect(typeof api.cancelStream).toBe('function');
  });

  it('exports admin-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.getUsers).toBe('function');
    expect(typeof api.getInvoices).toBe('function');
    expect(typeof api.freezeAccount).toBe('function');
    expect(typeof api.unfreezeAccount).toBe('function');
    expect(typeof api.updateUserRole).toBe('function');
    expect(typeof api.checkCompliance).toBe('function');
    expect(typeof api.resolveDispute).toBe('function');
  });

  it('exports KYC-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.verifyKYC).toBe('function');
    expect(typeof api.getKYCStatus).toBe('function');
  });

  it('exports market-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.getMarketPrices).toBe('function');
  });

  it('exports payment-related functions', async () => {
    const api = require('../utils/api');
    
    expect(typeof api.depositToEscrow).toBe('function');
    expect(typeof api.confirmRelease).toBe('function');
    expect(typeof api.raiseDispute).toBe('function');
  });

  it('exports setNavigateFunction for programmatic navigation', async () => {
    const { setNavigateFunction } = require('../utils/api');
    
    expect(typeof setNavigateFunction).toBe('function');
  });
});
