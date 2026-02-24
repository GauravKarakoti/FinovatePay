const express = require('express');
const router = express.Router();
const { authenticateToken, requireRole } = require('../middleware/auth');
const { requireKYC } = require('../middleware/kycValidation');
const { paymentLimiter } = require('../middleware/rateLimiter');
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

// Release escrow funds (using validateRelease instead of validatePaymentRelease)
router.post('/escrow/release', requireRole(['buyer', 'admin']), validateRelease, async (req, res) => {
  await releaseEscrow(req, res);
});

// Raise a dispute (using validateDispute instead of validatePaymentDispute)
router.post('/escrow/dispute', requireRole(['buyer', 'seller', 'admin']), validateDispute, async (req, res) => {
  await raiseDispute(req, res);
});

// Calculate fiat to crypto conversion
router.post('/onramp', requireRole(['buyer', 'seller', 'investor', 'admin']), validateOnramp, async (req, res) => {
    try {
        const { amount, currency } = req.body;
        const userId = req.user.id; // From authenticateToken middleware

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
        console.error('On-ramp error:', error);
        res.status(500).json({ error: 'Payment processing failed' });
    }
});

module.exports = router;