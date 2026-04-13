const { pool } = require('../config/database');
const CreditRiskProfile = require('../models/CreditRiskProfile');
const creditScoreService = require('./creditScoreService');
const axios = require('axios');
const { fetchOnchainFeatures } = require('./onchainFetcher');

/**
 * Credit Risk Assessment Service
 * 
 * Advanced ML-based credit risk scoring using:
 * - Behavioral Analysis: User activity patterns, login frequency, session duration
 * - Payment Velocity: Payment speed, consistency, early vs late payments
 * - Market Alignment: Comparison with market trends and benchmarks
 * - Financial Health: Revenue patterns, debt ratios, liquidity indicators
 * 
 * Integration with traditional credit scores for hybrid scoring
 */

// Weights for risk score calculation
const RISK_WEIGHTS = {
  BEHAVIORAL: 0.20,
  PAYMENT_VELOCITY: 0.30,
  MARKET_ALIGNMENT: 0.15,
  FINANCIAL_HEALTH: 0.20,
  TRADITIONAL_SCORE: 0.15
};

// Base interest rate configuration
const BASE_RATE_CONFIG = {
  MIN: 3.00,
  DEFAULT: 5.00,
  MAX: 25.00
};

/**
 * Calculate comprehensive risk profile for a user
 * @param {string} userId - User UUID
 * @returns {Object} Risk profile data
 */
const calculateRiskProfile = async (userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get existing profile for comparison
    const existingProfile = await CreditRiskProfile.findByUserId(userId);
    const previousRiskScore = existingProfile?.risk_score || null;

    // Gather all risk inputs
    const behavioralData = await analyzeBehavioralPatterns(client, userId);
    const paymentVelocityData = await analyzePaymentVelocity(client, userId);
    const marketData = await analyzeMarketAlignment(client, userId);
    const financialHealthData = await analyzeFinancialHealth(client, userId);
    
    // Get traditional credit score
    let traditionalScore = 50;
    try {
      const creditScoreData = await creditScoreService.getScoreByUserId(userId);
      traditionalScore = creditScoreData?.score || 50;
    } catch (error) {
      console.warn('[CreditRiskService] Could not get traditional score:', error.message);
    }

    // Calculate component scores
    const behavioralScore = calculateBehavioralScore(behavioralData);
    const paymentVelocityScore = calculatePaymentVelocityScore(paymentVelocityData);
    const marketAlignmentScore = calculateMarketAlignmentScore(marketData);
    const financialHealthScore = calculateFinancialHealthScore(financialHealthData);
    
    // Calculate overall risk score (0-100, lower is better)
    const riskScore = Math.round(
      (behavioralScore * RISK_WEIGHTS.BEHAVIORAL) +
      (paymentVelocityScore * RISK_WEIGHTS.PAYMENT_VELOCITY) +
      (marketAlignmentScore * RISK_WEIGHTS.MARKET_ALIGNMENT) +
      (financialHealthScore * RISK_WEIGHTS.FINANCIAL_HEALTH) +
      (traditionalScore * RISK_WEIGHTS.TRADITIONAL_SCORE)
    );

    const riskChange = previousRiskScore !== null ? riskScore - previousRiskScore : 0;

    // Calculate dynamic interest rate
    const { baseRate, riskAdjustment, dynamicRate } = calculateDynamicRate(riskScore);

    // Build risk factors for transparency
    const factors = buildRiskFactors({
      behavioralScore,
      paymentVelocityScore,
      marketAlignmentScore,
      financialHealthScore,
      traditionalScore,
      behavioralData,
      paymentVelocityData,
      marketData,
      financialHealthData
    });

    // Prepare risk profile data
    const riskProfileData = {
      behavioral_score: behavioralScore,
      payment_velocity_score: paymentVelocityScore,
      market_alignment_score: marketAlignmentScore,
      financial_health_score: financialHealthScore,
      risk_score: riskScore,
      previous_risk_score: previousRiskScore,
      risk_change: riskChange,
      base_rate: baseRate,
      risk_adjustment: riskAdjustment,
      dynamic_rate: dynamicRate,
      behavioral_features: behavioralData,
      payment_pattern_features: paymentVelocityData,
      market_features: marketData,
      model_version: 'v1.0',
      model_confidence: calculateModelConfidence(factors),
      factors
    };

    // Upsert risk profile
    const profile = await CreditRiskProfile.upsert(userId, riskProfileData);

    // Record history
    await CreditRiskProfile.recordHistory(userId, {
      ...riskProfileData,
      trigger_event: previousRiskScore === null ? 'initial_calculation' : 'scheduled_recalculation',
      trigger_description: previousRiskScore === null 
        ? 'Initial AI risk profile calculation' 
        : 'Periodic risk profile recalculation'
    });

    await client.query('COMMIT');

    // Return formatted result
    return formatRiskProfileResponse(profile, factors);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CreditRiskService] Error calculating risk profile:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Analyze behavioral patterns from user activity
 */
const analyzeBehavioralPatterns = async (client, userId) => {
  // Get user login/activity data (simulated - would need actual tracking)
  const userResult = await client.query(
    `SELECT 
      id, created_at, kyc_status, kyc_risk_level, role, wallet_address
     FROM users WHERE id = $1`,
    [userId]
  );

  if (userResult.rows.length === 0) {
    return getDefaultBehavioralData();
  }

  const user = userResult.rows[0];
  const accountAge = (Date.now() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30); // months

  const activityResult = await client.query(
    `SELECT 
      COUNT(*) as total_invoices,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as recent_invoices,
      COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_volume
    FROM invoices 
    WHERE seller_address = $1 OR buyer_address = $1`,
    [user.wallet_address] // FIX: Use wallet address instead of userId
  );

  const activity = activityResult.rows[0];

  return {
    account_age_months: Math.round(accountAge),
    kyc_verified: user.kyc_status === 'verified',
    kyc_risk_level: user.kyc_risk_level || 'unknown',
    total_invoices: parseInt(activity.total_invoices) || 0,
    recent_invoices: parseInt(activity.recent_invoices) || 0,
    activity_rate: parseInt(activity.total_invoices) > 0 
      ? parseInt(activity.recent_invoices) / parseInt(activity.total_invoices) 
      : 0,
    total_volume: parseFloat(activity.total_volume) || 0,
    user_role: user.role
  };
};

/**
 * Analyze payment velocity and patterns
 */
const analyzePaymentVelocity = async (client, userId) => {
  // Get seller's invoice payment data
  const sellerPayments = await client.query(
    `SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status IN ('completed', 'paid') THEN 1 END) as paid,
      COUNT(CASE WHEN status = 'pending' AND due_date < NOW() THEN 1 END) as overdue,
      AVG(CASE WHEN status IN ('completed', 'paid') 
        THEN EXTRACT(EPOCH FROM (paid_at - due_date))/86400 
        ELSE NULL END) as avg_days_early
     FROM invoices 
     WHERE seller_id = $1`,
    [userId]
  );

  const seller = sellerPayments.rows[0];

  // Get buyer's payment data
  const buyerPayments = await client.query(
    `SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status IN ('completed', 'paid') THEN 1 END) as paid,
      COUNT(CASE WHEN status = 'pending' AND due_date < NOW() THEN 1 END) as overdue,
      AVG(CASE WHEN status IN ('completed', 'paid') 
        THEN EXTRACT(EPOCH FROM (paid_at - due_date))/86400 
        ELSE NULL END) as avg_days_early
     FROM invoices 
     WHERE buyer_id = $1`,
    [userId]
  );

  const buyer = buyerPayments.rows[0];

  const totalInvoices = (parseInt(seller.total) || 0) + (parseInt(buyer.total) || 0);
  const totalPaid = (parseInt(seller.paid) || 0) + (parseInt(buyer.paid) || 0);
  const totalOverdue = (parseInt(seller.overdue) || 0) + (parseInt(buyer.overdue) || 0);
  
  return {
    total_invoices: totalInvoices,
    completed_invoices: totalPaid,
    overdue_invoices: totalOverdue,
    completion_rate: totalInvoices > 0 ? totalPaid / totalInvoices : 0,
    overdue_rate: totalInvoices > 0 ? totalOverdue / totalInvoices : 0,
    avg_days_early: (parseFloat(seller.avg_days_early) || 0) + (parseFloat(buyer.avg_days_early) || 0) / 2,
    payment_consistency_score: calculateConsistencyScore(seller, buyer)
  };
};

/**
 * Analyze market alignment
 */
const analyzeMarketAlignment = async (client, userId) => {
  // Get market benchmarks (would be from external data in production)
  const marketBenchmarks = await getMarketBenchmarks();

  // Get user's performance compared to benchmarks
  const userPerformance = await client.query(
    `SELECT 
      COALESCE(AVG(CAST(amount AS NUMERIC)), 0) as avg_invoice_amount,
      COUNT(*) as invoice_count,
      COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_volume
     FROM invoices 
     WHERE seller_id = $1 AND status IN ('completed', 'paid')`,
    [userId]
  );

  const user = userPerformance.rows[0];

  return {
    user_avg_amount: parseFloat(user.avg_invoice_amount) || 0,
    market_avg_amount: marketBenchmarks.avgInvoiceAmount,
    user_invoice_count: parseInt(user.invoice_count) || 0,
    market_avg_count: marketBenchmarks.avgInvoiceCount,
    volume_ratio: marketBenchmarks.avgInvoiceAmount > 0 
      ? parseFloat(user.avg_invoice_amount) / marketBenchmarks.avgInvoiceAmount 
      : 0,
    market_trend: marketBenchmarks.trend,
    sector_performance: marketBenchmarks.sectorPerformance
  };
};

/**
 * Analyze financial health indicators
 */
const analyzeFinancialHealth = async (client, userId) => {
  // Get revenue and outstanding amounts
  const financialData = await client.query(
    `SELECT 
      -- As Seller (receivables)
      COUNT(CASE WHEN seller_id = $1 AND status IN ('completed', 'paid') THEN 1 END) as completed_sales,
      COALESCE(SUM(CASE WHEN seller_id = $1 AND status IN ('completed', 'paid') THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) as total_revenue,
      COUNT(CASE WHEN seller_id = $1 AND status = 'pending' THEN 1 END) as pending_receivables,
      COALESCE(SUM(CASE WHEN seller_id = $1 AND status = 'pending' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) as outstanding_receivables,
      
      -- As Buyer (payables)
      COUNT(CASE WHEN buyer_id = $1 AND status = 'pending' THEN 1 END) as pending_payables,
      COALESCE(SUM(CASE WHEN buyer_id = $1 AND status = 'pending' THEN CAST(amount AS NUMERIC) ELSE 0 END), 0) as outstanding_payables
     FROM invoices`,
    [userId]
  );

  const data = financialData.rows[0];
  const totalRevenue = parseFloat(data.total_revenue) || 0;
  const outstandingReceivables = parseFloat(data.outstanding_receivables) || 0;
  const outstandingPayables = parseFloat(data.outstanding_payables) || 0;

  // Calculate financial health ratios
  const receivablesRatio = totalRevenue > 0 ? outstandingReceivables / totalRevenue : 0;
  const debtServiceRatio = totalRevenue > 0 ? outstandingPayables / totalRevenue : 0;

  return {
    total_revenue: totalRevenue,
    outstanding_receivables: outstandingReceivables,
    outstanding_payables: outstandingPayables,
    receivables_turnover: receivablesRatio,
    debt_service_ratio: debtServiceRatio,
    revenue_growth_potential: parseInt(data.completed_sales) || 0,
    liquidity_indicator: totalRevenue > 0 ? (outstandingReceivables - outstandingPayables) / totalRevenue : 0
  };
};

/**
 * Calculate behavioral score (0-100)
 */
const calculateBehavioralScore = (data) => {
  let score = 50;

  // Account age bonus
  if (data.account_age_months >= 12) score += 15;
  else if (data.account_age_months >= 6) score += 10;
  else if (data.account_age_months >= 3) score += 5;

  // KYC verification
  if (data.kyc_verified) {
    score += 15;
    if (data.kyc_risk_level === 'low') score += 10;
    else if (data.kyc_risk_level === 'medium') score += 5;
  } else {
    score -= 10;
  }

  // Activity rate
  if (data.activity_rate > 0.5) score += 10;
  else if (data.activity_rate > 0.25) score += 5;

  // Transaction volume
  if (data.total_volume > 50000) score += 10;
  else if (data.total_volume > 10000) score += 5;

  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate payment velocity score (0-100)
 */
const calculatePaymentVelocityScore = (data) => {
  let score = 50;

  // Completion rate (most important)
  if (data.completion_rate >= 0.95) score += 25;
  else if (data.completion_rate >= 0.85) score += 15;
  else if (data.completion_rate >= 0.70) score += 5;
  else if (data.completion_rate < 0.50) score -= 20;

  // Overdue rate (penalize heavily)
  if (data.overdue_rate <= 0.05) score += 15;
  else if (data.overdue_rate <= 0.10) score += 5;
  else if (data.overdue_rate > 0.25) score -= 20;

  // Early payment bonus
  if (data.avg_days_early > 5) score += 10;
  else if (data.avg_days_early > 0) score += 5;

  // Consistency
  score += data.payment_consistency_score * 10;

  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate market alignment score (0-100)
 */
const calculateMarketAlignmentScore = (data) => {
  let score = 50;

  // Volume ratio
  if (data.volume_ratio >= 1.0) score += 15;
  else if (data.volume_ratio >= 0.5) score += 5;
  else if (data.volume_ratio < 0.25) score -= 10;

  // Transaction count
  if (data.user_invoice_count >= data.market_avg_count) score += 10;
  else if (data.user_invoice_count >= data.market_avg_count * 0.5) score += 5;

  // Market trend alignment
  if (data.market_trend === 'up') score += 10;
  else if (data.market_trend === 'down') score -= 5;

  // Sector performance
  if (data.sector_performance > 0.8) score += 10;
  else if (data.sector_performance < 0.5) score -= 10;

  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate financial health score (0-100)
 */
const calculateFinancialHealthScore = (data) => {
  let score = 50;

  // Revenue
  if (data.total_revenue > 100000) score += 20;
  else if (data.total_revenue > 50000) score += 15;
  else if (data.total_revenue > 10000) score += 10;
  else if (data.total_revenue === 0) score -= 10;

  // Receivables turnover (lower is better)
  if (data.receivables_turnover < 0.2) score += 15;
  else if (data.receivables_turnover < 0.5) score += 5;
  else if (data.receivables_turnover > 1.0) score -= 15;

  // Debt service ratio (lower is better)
  if (data.debt_service_ratio < 0.3) score += 15;
  else if (data.debt_service_ratio < 0.5) score += 5;
  else if (data.debt_service_ratio > 0.8) score -= 15;

  // Liquidity
  if (data.liquidity_indicator > 0.5) score += 10;
  else if (data.liquidity_indicator < 0) score -= 10;

  return Math.max(0, Math.min(100, score));
};

/**
 * Calculate dynamic interest rate based on risk score
 */
const calculateDynamicRate = (riskScore) => {
  // Risk score 0-100, lower is better
  // Map to interest rate: risk 0 = 3%, risk 100 = 25%
  const baseRate = BASE_RATE_CONFIG.MIN + 
    ((100 - riskScore) / 100) * (BASE_RATE_CONFIG.MAX - BASE_RATE_CONFIG.MIN);
  
  // Adjustments based on risk score ranges
  let riskAdjustment = 0;
  if (riskScore <= 20) riskAdjustment = -2.00; // Excellent risk gets discount
  else if (riskScore <= 35) riskAdjustment = -1.00;
  else if (riskScore <= 50) riskAdjustment = 0;
  else if (riskScore <= 70) riskAdjustment = 1.00;
  else riskAdjustment = 2.00; // High risk gets premium

  const dynamicRate = Math.max(BASE_RATE_CONFIG.MIN, 
    Math.min(BASE_RATE_CONFIG.MAX, baseRate + riskAdjustment));

  return {
    baseRate: parseFloat(baseRate.toFixed(2)),
    riskAdjustment: parseFloat(riskAdjustment.toFixed(2)),
    dynamicRate: parseFloat(dynamicRate.toFixed(2))
  };
};

/**
 * Build detailed risk factors for transparency
 */
const buildRiskFactors = (scores) => {
  const factors = [];

  // Behavioral factors
  factors.push({
    factor_name: 'Account Age & Verification',
    factor_category: 'behavioral',
    factor_weight: 0.20,
    factor_value: scores.behavioralScore,
    factor_impact: scores.behavioralScore >= 60 ? 'positive' : scores.behavioralScore <= 40 ? 'negative' : 'neutral',
    factor_description: 'Based on account age and KYC verification status'
  });

  // Payment velocity factors
  factors.push({
    factor_name: 'Payment Performance',
    factor_category: 'payment_velocity',
    factor_weight: 0.30,
    factor_value: scores.paymentVelocityScore,
    factor_impact: scores.paymentVelocityScore >= 60 ? 'positive' : scores.paymentVelocityScore <= 40 ? 'negative' : 'neutral',
    factor_description: 'Based on payment completion rate and timeliness'
  });

  // Market factors
  factors.push({
    factor_name: 'Market Position',
    factor_category: 'market',
    factor_weight: 0.15,
    factor_value: scores.marketAlignmentScore,
    factor_impact: scores.marketAlignmentScore >= 60 ? 'positive' : scores.marketAlignmentScore <= 40 ? 'negative' : 'neutral',
    factor_description: 'Based on performance relative to market benchmarks'
  });

  // Financial health factors
  factors.push({
    factor_name: 'Financial Health',
    factor_category: 'financial',
    factor_weight: 0.20,
    factor_value: scores.financialHealthScore,
    factor_impact: scores.financialHealthScore >= 60 ? 'positive' : scores.financialHealthScore <= 40 ? 'negative' : 'neutral',
    factor_description: 'Based on revenue, receivables, and liquidity indicators'
  });

  // Traditional credit score factor
  factors.push({
    factor_name: 'Traditional Credit Score',
    factor_category: 'traditional',
    factor_weight: 0.15,
    factor_value: scores.traditionalScore,
    factor_impact: scores.traditionalScore >= 70 ? 'positive' : scores.traditionalScore <= 50 ? 'negative' : 'neutral',
    factor_description: 'Based on existing credit score calculation'
  });

  return factors;
};

/**
 * Calculate model confidence based on factor coverage
 */
const calculateModelConfidence = (factors) => {
  const positiveFactors = factors.filter(f => f.factor_impact === 'positive').length;
  const totalFactors = factors.length;
  
  // Confidence is higher when more factors are positive (more data available)
  let confidence = 0.5 + (positiveFactors / totalFactors) * 0.4;
  
  return parseFloat(confidence.toFixed(2));
};

/**
 * Get market benchmarks (simulated - would be from external API)
 */
const getMarketBenchmarks = async () => {
  // In production, this would fetch from external market data APIs
  return {
    avgInvoiceAmount: 15000,
    avgInvoiceCount: 20,
    trend: 'up',
    sectorPerformance: 0.75
  };
};

/**
 * Get default behavioral data for new users
 */
const getDefaultBehavioralData = () => {
  return {
    account_age_months: 0,
    kyc_verified: false,
    kyc_risk_level: 'unknown',
    total_invoices: 0,
    recent_invoices: 0,
    activity_rate: 0,
    total_volume: 0,
    user_role: 'user'
  };
};

/**
 * Calculate payment consistency score
 */
const calculateConsistencyScore = (seller, buyer) => {
  const sellerRate = parseInt(seller.total) > 0 
    ? parseInt(seller.paid) / parseInt(seller.total) 
    : 0.5;
  const buyerRate = parseInt(buyer.total) > 0 
    ? parseInt(buyer.paid) / parseInt(buyer.total) 
    : 0.5;
  
  return (sellerRate + buyerRate) / 2;
};

/**
 * Format risk profile response
 */
const formatRiskProfileResponse = (profile, factors) => {
  const getRiskLabel = (category) => {
    const labels = {
      excellent: { label: 'Excellent', color: 'green' },
      good: { label: 'Good', color: 'blue' },
      moderate: { label: 'Moderate', color: 'yellow' },
      high: { label: 'High Risk', color: 'orange' },
      very_high: { label: 'Very High Risk', color: 'red' }
    };
    return labels[category] || labels.moderate;
  };

  const riskInfo = getRiskLabel(profile.risk_category);

  return {
    userId: profile.user_id,
    riskScore: profile.risk_score,
    riskScoreChange: profile.risk_change,
    riskCategory: profile.risk_category,
    riskCategoryLabel: riskInfo.label,
    riskCategoryColor: riskInfo.color,
    componentScores: {
      behavioral: { score: profile.behavioral_score, weight: RISK_WEIGHTS.BEHAVIORAL * 100 },
      paymentVelocity: { score: profile.payment_velocity_score, weight: RISK_WEIGHTS.PAYMENT_VELOCITY * 100 },
      marketAlignment: { score: profile.market_alignment_score, weight: RISK_WEIGHTS.MARKET_ALIGNMENT * 100 },
      financialHealth: { score: profile.financial_health_score, weight: RISK_WEIGHTS.FINANCIAL_HEALTH * 100 },
      traditionalScore: { score: profile.traditional_score || 50, weight: RISK_WEIGHTS.TRADITIONAL_SCORE * 100 }
    },
    dynamicRate: {
      base: profile.base_rate,
      adjustment: profile.risk_adjustment,
      rate: profile.dynamic_rate,
      rateType: 'annual_percentage'
    },
    factors: factors.map(f => ({
      name: f.factor_name,
      category: f.factor_category,
      weight: f.factor_weight * 100,
      score: f.factor_value,
      impact: f.factor_impact,
      description: f.factor_description
    })),
    modelInfo: {
      version: profile.model_version,
      confidence: profile.model_confidence,
      lastCalculated: profile.last_calculated_at
    }
  };
};

/**
 * Get risk profile by user ID
 */
const getRiskProfileByUserId = async (userId) => {
  try {
    const profile = await CreditRiskProfile.findByUserIdWithFactors(userId);
    
    if (!profile) {
      // Calculate if not exists
      return await calculateRiskProfile(userId);
    }

    return formatRiskProfileResponse(profile, profile.factors || []);
  } catch (error) {
    console.error('[CreditRiskService] Error getting risk profile:', error);
    throw error;
  }
};

/**
 * Get dynamic interest rate for a user
 */
const getDynamicInterestRate = async (userId) => {
  try {
    const profile = await getRiskProfileByUserId(userId);
    
    return {
      userId,
      rate: profile.dynamicRate.rate,
      baseRate: profile.dynamicRate.base,
      riskAdjustment: profile.dynamicRate.adjustment,
      riskScore: profile.riskScore,
      riskCategory: profile.riskCategory,
      effectiveFrom: new Date().toISOString()
    };
  } catch (error) {
    console.error('[CreditRiskService] Error getting dynamic rate:', error);
    throw error;
  }
};

/**
 * Get risk history for a user
 */
const getRiskHistory = async (userId, limit = 10) => {
  try {
    return await CreditRiskProfile.getHistory(userId, limit);
  } catch (error) {
    console.error('[CreditRiskService] Error getting risk history:', error);
    throw error;
  }
};

/**
 * Get all risk profiles (admin)
 */
const getAllRiskProfiles = async (limit = 100, offset = 0) => {
  try {
    return await CreditRiskProfile.getAll(limit, offset);
  } catch (error) {
    console.error('[CreditRiskService] Error getting all profiles:', error);
    throw error;
  }
};

/**
 * Get risk profiles by category (admin)
 */
const getRiskProfilesByCategory = async (category) => {
  try {
    return await CreditRiskProfile.getByCategory(category);
  } catch (error) {
    console.error('[CreditRiskService] Error getting by category:', error);
    throw error;
  }
};

module.exports = {
  calculateRiskProfile,
  getRiskProfileByUserId,
  getDynamicInterestRate,
  getRiskHistory,
  getAllRiskProfiles,
  getRiskProfilesByCategory,
  analyzeCreditRisk,
  RISK_WEIGHTS,
  BASE_RATE_CONFIG
};

/**
 * Analyze credit risk via external ML microservice.
 * Accepts { userId, walletAddress, force }
 */
async function analyzeCreditRisk({ userId, walletAddress, force = false }) {
  const client = await pool.connect();
  try {
    // Gather features using existing analysis functions
    const behavioralData = await analyzeBehavioralPatterns(client, userId);
    const paymentVelocityData = await analyzePaymentVelocity(client, userId);
    const marketData = await analyzeMarketAlignment(client, userId);
    const financialHealthData = await analyzeFinancialHealth(client, userId);

    const onchain = await fetchOnchainFeatures({ userId, walletAddress });

    const payload = {
      userId,
      walletAddress,
      features: {
        behavioral: behavioralData,
        payment_velocity: paymentVelocityData,
        market: marketData,
        financial: financialHealthData,
        onchain
      },
      force
    };

    const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:5000';

    const resp = await axios.post(`${mlUrl}/predict`, payload, { timeout: 15000 });

    const mlResult = resp.data || {};

    // Optionally upsert the returned profile into CreditRiskProfile for record
    if (mlResult && mlResult.riskScore != null) {
      const riskProfileData = {
        behavioral_score: mlResult.componentScores?.behavioral || behavioralData.behavioral_score || 0,
        payment_velocity_score: mlResult.componentScores?.paymentVelocity || paymentVelocityData.payment_consistency_score || 0,
        market_alignment_score: mlResult.componentScores?.marketAlignment || marketData.volume_ratio || 0,
        financial_health_score: mlResult.componentScores?.financial || financialHealthData.liquidity_indicator || 0,
        risk_score: mlResult.riskScore,
        risk_category: mlResult.category || null,
        model_version: mlResult.modelVersion || 'ml-service',
        model_confidence: mlResult.confidence || null
      };

      try {
        await CreditRiskProfile.upsert(userId, riskProfileData);
      } catch (err) {
        console.warn('[CreditRiskService] Failed to upsert ML result:', err.message);
      }
    }

    return mlResult;
  } catch (error) {
    console.error('[CreditRiskService] ML analysis failed:', error?.message || error);
    throw error;
  } finally {
    client.release();
  }
}

