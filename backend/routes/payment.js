const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { paymentLimiter } = require('../middleware/rateLimiter');
const { pool } = require('../config/database');
const fraudDetectionService = require('../services/fraudDetectionService');
const {
  releaseEscrow,
  raiseDispute
} = require('../controllers/escrowController');

// Corrected validator imports
const { 
  validateRelease, 
  validateDispute,
  validateOnramp 
} = require('../middleware/validators');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// All payment routes require authentication and KYC
router.use(authenticateToken);
router.use(requireKYC);

// Apply payment rate limiter to all payment routes
router.use(paymentLimiter);

const runFraudGate = async ({ req, transactionType, amount, currency, invoiceId, context }) => {
  try {
    const result = await fraudDetectionService.evaluateTransactionRisk({
      userId: req.user?.id,
      walletAddress: req.user?.wallet_address,
      invoiceId,
      transactionType,
      amount,
      currency,
      context: {
        ...(context || {}),
        endpoint: req.originalUrl,
        method: req.method,
        actorRole: req.user?.role,
        kycStatus: req.user?.kyc_status || 'unknown'
      }
    });
    fraudDetectionService.ensureTransactionAllowed(result);
    return result;
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      throw error;
    }
    console.error('[PaymentRoutes] Fraud gate degraded:', error.message);
    return null;
  }
};

const getInvoicePaymentContext = async (invoiceId) => {
  if (!invoiceId) {
    return { amount: 0, currency: 'USD' };
  }

  const result = await pool.query(
    'SELECT amount, currency FROM invoices WHERE invoice_id = $1',
    [invoiceId]
  );

  return {
    amount: result.rows[0]?.amount || 0,
    currency: result.rows[0]?.currency || 'USD'
  };
};

// Release escrow funds (using validateRelease instead of validatePaymentRelease)
router.post('/escrow/release', requireRole(['buyer', 'admin']), validateRelease, async (req, res) => {
  try {
    const invoiceId = req.body?.invoiceId;
    const { amount, currency } = await getInvoicePaymentContext(invoiceId);
    const risk = await runFraudGate({
      req,
      transactionType: 'payment_release',
      amount,
      currency,
      invoiceId,
      context: { action: 'escrow_release' }
    });

    if (risk?.shouldReview) {
      console.warn('[PaymentRoutes] Escrow release flagged for review', {
        invoiceId,
        riskScore: risk.riskScore
      });
    }

    await releaseEscrow(req, res);
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      return res.status(error.statusCode || 403).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    console.error('[PaymentRoutes] Release fraud check failed:', error);
    return res.status(500).json({ success: false, error: 'Payment fraud verification failed' });
  }
});

// Raise a dispute (using validateDispute instead of validatePaymentDispute)
router.post('/escrow/dispute', requireRole(['buyer', 'seller', 'admin']), validateDispute, async (req, res) => {
  try {
    const invoiceId = req.body?.invoiceId;
    const { amount, currency } = await getInvoicePaymentContext(invoiceId);
    const risk = await runFraudGate({
      req,
      transactionType: 'payment_dispute',
      amount,
      currency,
      invoiceId,
      context: { action: 'escrow_dispute' }
    });

    if (risk?.shouldReview) {
      console.warn('[PaymentRoutes] Dispute action flagged for review', {
        invoiceId,
        riskScore: risk.riskScore
      });
    }

    await raiseDispute(req, res);
  } catch (error) {
    if (error.code === 'FRAUD_BLOCKED') {
      return res.status(error.statusCode || 403).json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.details
      });
    }
    console.error('[PaymentRoutes] Dispute fraud check failed:', error);
    return res.status(500).json({ success: false, error: 'Payment fraud verification failed' });
  }
});

// Calculate fiat to crypto conversion
router.post('/onramp', requireRole(['buyer', 'seller', 'investor', 'admin']), validateOnramp, async (req, res) => {
    try {
        const { amount, currency } = req.body;
        const userId = req.user.id; // From authenticateToken middleware

    const risk = await runFraudGate({
      req,
      transactionType: 'payment_onramp',
      amount,
      currency,
      context: { action: 'fiat_onramp' }
    });

    if (risk?.shouldReview) {
      console.warn('[PaymentRoutes] Onramp flagged for review', {
        userId,
        riskScore: risk.riskScore
      });
    }

        // 1. Validate Input
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        // 2. Create Payment Session (Example using Stripe Checkout)
        console.log(stripe.checkout);
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: currency.toLowerCase(),
                    product_data: {
                        name: 'USDC Top-up',
                        description: 'Stablecoin purchase for FinovatePay',
                    },
                    unit_amount: Math.round(amount * 100), // Convert to cents
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${process.env.FRONTEND_URL}/investor?payment=success&amount=${amount}`,
            cancel_url: `${process.env.FRONTEND_URL}/investor?payment=cancelled`,
            metadata: { userId, type: 'onramp' }
        });
        
        return res.json({ paymentUrl: session.url });
    } catch (error) {
        if (error.code === 'FRAUD_BLOCKED') {
          return res.status(error.statusCode || 403).json({
            success: false,
            error: error.message,
            code: error.code,
            details: error.details
          });
        }
        console.error('On-ramp error:', error);
        res.status(500).json({ error: 'Payment processing failed' });
    }
});

module.exports = router;