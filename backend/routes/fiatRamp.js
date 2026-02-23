const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

// All fiat ramp routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

// Apply payment rate limiter
router.use(paymentLimiter);

/**
 * POST /api/fiat-ramp/create-link
 * Create a MoonPay payment link for purchasing stablecoins
 */
router.post('/create-link', requireRole(['buyer', 'seller', 'investor', 'admin']), async (req, res) => {
    try {
        const { amount, currency = 'USD', cryptoCurrency = 'USDC', walletAddress } = req.body;
        const userId = req.user.id;

        // Validate input
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        if (!walletAddress) {
            return res.status(400).json({ error: 'Wallet address is required' });
        }

        // Get MoonPay API keys from environment
        const moonpayApiKey = process.env.MOONPAY_API_KEY;
        const moonpaySecretKey = process.env.MOONPAY_SECRET_KEY;
        const isTestnet = process.env.NODE_ENV !== 'production';

        if (!moonpayApiKey) {
            // Fallback: Generate a mock payment link for testing
            console.warn('MoonPay API key not configured. Using mock payment link.');
            
            const mockPaymentId = uuidv4();
            const baseUrl = isTestnet 
                ? 'https://buy-staging.moonpay.com' 
                : 'https://buy.moonpay.com';
            
            const mockParams = new URLSearchParams({
                apiKey: 'test_key',
                currencyAbbreviation: cryptoCurrency.toLowerCase(),
                walletAddress: walletAddress,
                baseCurrencyAmount: amount.toString(),
                baseCurrency: currency,
                externalTransactionId: mockPaymentId,
                redirectURL: `${process.env.FRONTEND_URL}/?payment=success&provider=moonpay&txId=${mockPaymentId}`,
            });

            return res.json({
                success: true,
                provider: 'moonpay',
                paymentId: mockPaymentId,
                paymentUrl: `${baseUrl}?${mockParams.toString()}`,
                amount: parseFloat(amount),
                currency,
                cryptoCurrency,
                walletAddress,
                testMode: isTestnet
            });
        }

        // Create a signed URL for MoonPay widget
        const timestamp = Math.floor(Date.now() / 1000);
        const transactionId = uuidv4();
        
        // Build the signature base
        const signatureBase = `${moonpaySecretKey}${timestamp}`;
        const crypto = require('crypto');
        const signature = crypto.createHash('sha256').update(signatureBase).digest('hex');

        // Build MoonPay URL parameters
        const baseUrl = isTestnet 
            ? 'https://buy-staging.moonpay.com' 
            : 'https://buy.moonpay.com';

        const params = new URLSearchParams({
            apiKey: moonpayApiKey,
            currencyAbbreviation: cryptoCurrency.toLowerCase(),
            walletAddress: walletAddress,
            baseCurrencyAmount: amount.toString(),
            baseCurrency: currency.toLowerCase(),
            externalTransactionId: transactionId,
            signature: signature,
            timestamp: timestamp.toString(),
            redirectURL: `${process.env.FRONTEND_URL}/?payment=success&provider=moonpay&txId=${transactionId}`,
        });

        const paymentUrl = `${baseUrl}?${params.toString()}`;

        // Optionally: Create transaction record in database
        // await createFiatRampTransaction({ userId, transactionId, amount, currency, cryptoCurrency, walletAddress });

        console.log(`MoonPay payment link created for user ${userId}: ${transactionId}`);

        return res.json({
            success: true,
            provider: 'moonpay',
            paymentId: transactionId,
            paymentUrl,
            amount: parseFloat(amount),
            currency,
            cryptoCurrency,
            walletAddress,
            testMode: isTestnet
        });

    } catch (error) {
        console.error('MoonPay create-link error:', error);
        res.status(500).json({ error: 'Failed to create payment link' });
    }
});

/**
 * POST /api/fiat-ramp/webhook
 * Handle MoonPay webhook callbacks for payment confirmation
 */
router.post('/webhook', async (req, res) => {
    try {
        const webhookData = req.body;
        const signature = req.headers['x-moonpay-signature'];

        // Verify webhook signature (in production)
        const moonpayWebhookKey = process.env.MOONPAY_WEBHOOK_KEY;
        
        if (moonpayWebhookKey && signature) {
            const crypto = require('crypto');
            const expectedSignature = crypto
                .createHmac('sha256', moonpayWebhookKey)
                .update(JSON.stringify(webhookData))
                .digest('hex');

            if (signature !== expectedSignature) {
                console.warn('Invalid MoonPay webhook signature');
                return res.status(401).json({ error: 'Invalid signature' });
            }
        }

        const { type, data } = webhookData;

        console.log(`MoonPay webhook received: ${type}`, data);

        switch (type) {
            case 'payment.created':
                // Payment initiated
                console.log(`Payment created: ${data.externalTransactionId}`);
                break;

            case 'payment.pending':
                // Payment is being processed
                console.log(`Payment pending: ${data.externalTransactionId}`);
                break;

            case 'payment.failed':
                // Payment failed
                console.log(`Payment failed: ${data.externalTransactionId}, Reason: ${data.failedReason}`);
                // Update transaction status in database
                // await updateFiatRampTransactionStatus(data.externalTransactionId, 'failed', data);
                break;

            case 'payment.completed':
                // Payment successful - crypto has been sent
                console.log(`Payment completed: ${data.externalTransactionId}`);
                console.log(`Crypto sent: ${data.cryptoTransactionHash}`);
                
                // Update transaction status in database
                // await updateFiatRampTransactionStatus(data.externalTransactionId, 'completed', data);
                
                // Optionally: Notify user via socket or update their balance
                // const io = req.app.get('io');
                // io.emit('payment-completed', { transactionId: data.externalTransactionId, ...data });
                break;

            case 'crypto_transactions.created':
                // Crypto transaction created (on-chain)
                console.log(`Crypto transaction created: ${data.id}`);
                break;

            case 'crypto_transactions.confirmed':
                // Crypto transaction confirmed on blockchain
                console.log(`Crypto transaction confirmed: ${data.id}, Hash: ${data.hash}`);
                break;

            default:
                console.log(`Unhandled webhook type: ${type}`);
        }

        return res.json({ received: true });

    } catch (error) {
        console.error('MoonPay webhook error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

/**
 * GET /api/fiat-ramp/status/:transactionId
 * Check the status of a fiat ramp transaction
 */
router.get('/status/:transactionId', authenticateToken, async (req, res) => {
    try {
        const { transactionId } = req.params;
        const userId = req.user.id;

        // In production: Fetch from database
        // const transaction = await getFiatRampTransaction(transactionId, userId);
        
        // For now, return mock status
        // This would be replaced with actual database queries
        
        // Mock response for testing
        return res.json({
            success: true,
            transactionId,
            status: 'pending', // Would be fetched from DB
            message: 'Transaction status check - implement with database'
        });

    } catch (error) {
        console.error('Status check error:', error);
        res.status(500).json({ error: 'Failed to check transaction status' });
    }
});

/**
 * GET /api/fiat-ramp/quote
 * Get current exchange quote for fiat to crypto
 */
router.get('/quote', async (req, res) => {
    try {
        const { amount, currency = 'USD', cryptoCurrency = 'USDC' } = req.query;

        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const moonpayApiKey = process.env.MOONPAY_API_KEY;
        const isTestnet = process.env.NODE_ENV !== 'production';

        // Try to get live quotes from MoonPay API
        if (moonpayApiKey) {
            try {
                const baseUrl = isTestnet 
                    ? 'https://api-staging.moonpay.com' 
                    : 'https://api.moonpay.com';
                
                const response = await axios.get(
                    `${baseUrl}/v1/currencies/${cryptoCurrency.toLowerCase()}/buy_quote`,
                    {
                        params: {
                            baseCurrencyAmount: amount,
                            baseCurrency: currency.toLowerCase(),
                            apiKey: moonpayApiKey
                        }
                    }
                );

                return res.json({
                    success: true,
                    provider: 'moonpay',
                    quote: response.data,
                    testMode: isTestnet
                });
            } catch (apiError) {
                console.warn('MoonPay quote API error:', apiError.message);
            }
        }

        // Fallback: Return estimated quote (USDC is pegged 1:1 to USD)
        const feePercent = 0.0149; // 1.49% MoonPay fee
        const networkFee = 0.0001; // Estimated network fee
        
        const fiatAmount = parseFloat(amount);
        const fee = fiatAmount * feePercent;
        const netAmount = fiatAmount - fee;
        
        return res.json({
            success: true,
            provider: 'moonpay',
            quote: {
                baseCurrency: currency,
                baseCurrencyAmount: fiatAmount,
                quoteCurrency: cryptoCurrency,
                quoteCurrencyAmount: netAmount,
                fee: fee,
                networkFee: networkFee,
                total: fiatAmount
            },
            testMode: isTestnet,
            note: 'Estimated quote (API unavailable)'
        });

    } catch (error) {
        console.error('Quote error:', error);
        res.status(500).json({ error: 'Failed to get exchange quote' });
    }
});

module.exports = router;
