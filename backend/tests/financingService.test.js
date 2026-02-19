const { financeInvoice } = require('../services/financingService');
const katanaService = require('../services/katanaService');
const waltBridgeService = require('../services/waltBridgeService');
const { pool } = require('../config/database');

jest.mock('../services/katanaService');
jest.mock('../services/waltBridgeService');
jest.mock('../config/database');

describe('Financing Service', () => {
    let mockClient;

    beforeEach(() => {
        // Reset mocks before each test
        jest.clearAllMocks();

        // Setup Pool mock
        mockClient = {
            query: jest.fn(),
            release: jest.fn(),
        };
        pool.connect.mockResolvedValue(mockClient);

        // Setup Katana mock default behavior
        katanaService.requestLiquidity.mockResolvedValue({
            success: true,
            fundedAmount: 1000,
            liquidityId: 'liq_123'
        });

        // Setup WaltBridge mock default behavior
        waltBridgeService.bridgeFunds.mockResolvedValue({
            txHash: '0xBridgeTxHash',
            amount: 1000
        });
    });

    test('should successfully finance a valid invoice', async () => {
        // Mock DB query for invoice fetch
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                invoice_hash: '0xInvoiceHash',
                seller_address: '0xSellerAddress',
                financing_status: 'listed'
            }]
        });

        // Mock DB update query
        mockClient.query.mockResolvedValueOnce({}); // Update query

        const result = await financeInvoice('0xInvoiceHash', '1', null, 1000);

        expect(result.success).toBe(true);
        expect(result.invoiceHash).toBe('0xInvoiceHash');
        expect(result.bridgeTxHash).toBe('0xBridgeTxHash');

        // Verify mocks called
        expect(pool.connect).toHaveBeenCalled();
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM invoices'), ['0xInvoiceHash']);
        expect(katanaService.requestLiquidity).toHaveBeenCalledWith(1000);
        expect(waltBridgeService.bridgeFunds).toHaveBeenCalledWith(1000, '0xSellerAddress');
        expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE invoices'), expect.any(Array));
        expect(mockClient.release).toHaveBeenCalled();
    });

    test('should skip if invoice is already financed', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                invoice_hash: '0xInvoiceHash',
                seller_address: '0xSellerAddress',
                financing_status: 'financed'
            }]
        });

        const result = await financeInvoice('0xInvoiceHash', '1', null, 1000);

        expect(result).toBeUndefined();
        expect(katanaService.requestLiquidity).not.toHaveBeenCalled();
    });

    test('should fail if invoice not found', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: []
        });

        const result = await financeInvoice('0xInvoiceHash', '1', null, 1000);

        expect(result).toBeUndefined();
        expect(katanaService.requestLiquidity).not.toHaveBeenCalled();
    });

    test('should throw error if seller address is missing', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                invoice_hash: '0xInvoiceHash',
                seller_address: null, // No seller
                financing_status: 'listed'
            }]
        });

        await expect(financeInvoice('0xInvoiceHash', '1', null, 1000))
            .rejects.toThrow('Seller address missing for invoice.');
    });

    test('should throw error if Katana liquidity fails', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                invoice_hash: '0xInvoiceHash',
                seller_address: '0xSellerAddress',
                financing_status: 'listed'
            }]
        });

        katanaService.requestLiquidity.mockResolvedValueOnce({ success: false });

        await expect(financeInvoice('0xInvoiceHash', '1', null, 1000))
            .rejects.toThrow('Katana liquidity request failed.');
    });

    test('should handle DB update failure gracefully (fallback)', async () => {
        mockClient.query.mockResolvedValueOnce({
            rows: [{
                invoice_hash: '0xInvoiceHash',
                seller_address: '0xSellerAddress',
                financing_status: 'listed'
            }]
        });

        // Fail the first update query (trying to update payment_tx_hash)
        mockClient.query.mockRejectedValueOnce(new Error('Column payment_tx_hash does not exist'));

        // Mock fallback update query success
        mockClient.query.mockResolvedValueOnce({});

        const result = await financeInvoice('0xInvoiceHash', '1', null, 1000);

        expect(result.success).toBe(true);
        // Verify fallback query was called
        expect(mockClient.query).toHaveBeenCalledTimes(3); // Select, Update (fail), Fallback Update
    });
});
