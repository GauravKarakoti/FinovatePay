const { pool } = require('../config/database');

/**
 * Credit Score Service
 * 
 * Calculates and manages user credit/trust scores based on:
 * - Payment History (40%): Based on completed vs pending payments
 * - Dispute Ratio (30%): Lower disputes = higher score
 * - KYC Completion (20%): Verified KYC boosts score
 * - Transaction Volume (10%): Higher volume = higher score
 */

// Weight constants for scoring
const WEIGHTS = {
  PAYMENT_HISTORY: 0.40,
  DISPUTE_RATIO: 0.30,
  KYC: 0.20,
  TRANSACTION_VOLUME: 0.10
};

/**
 * Calculate credit score for a user
 * @param {string} userId - User UUID
 * @returns {Object} Credit score data
 */
const calculateScore = async (userId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get user's payment statistics
    const paymentStats = await getPaymentStats(client, userId);
    
    // Get user's dispute statistics
    const disputeStats = await getDisputeStats(client, userId);
    
    // Get user's KYC status
    const kycStatus = await getKycStatus(client, userId);
    
    // Get user's transaction volume
    const volumeStats = await getTransactionVolume(client, userId);

    // Calculate individual scores
    const paymentHistoryScore = calculatePaymentHistoryScore(paymentStats);
    const disputeRatioScore = calculateDisputeRatioScore(disputeStats);
    const kycScore = calculateKycScore(kycStatus);
    const transactionVolumeScore = calculateVolumeScore(volumeStats);

    // Calculate weighted total score
    const totalScore = Math.round(
      (paymentHistoryScore * WEIGHTS.PAYMENT_HISTORY) +
      (disputeRatioScore * WEIGHTS.DISPUTE_RATIO) +
      (kycScore * WEIGHTS.KYC) +
      (transactionVolumeScore * WEIGHTS.TRANSACTION_VOLUME)
    );

    // Get previous score
    const previousScoreResult = await client.query(
      'SELECT score FROM credit_scores WHERE user_id = $1',
      [userId]
    );
    const previousScore = previousScoreResult.rows[0]?.score || null;
    const scoreChange = previousScore !== null ? totalScore - previousScore : 0;

    // Upsert credit score record
    const scoreData = {
      userId,
      score: totalScore,
      paymentHistoryScore,
      disputeRatioScore,
      kycScore,
      transactionVolumeScore,
      previousScore,
      scoreChange,
      totalTransactions: paymentStats.total,
      completedPayments: paymentStats.completed,
      disputedPayments: disputeStats.disputed,
      totalVolume: volumeStats.total,
      kycStatus: kycStatus.status
    };

    await upsertCreditScore(client, scoreData);

    // Record history
    await recordScoreHistory(client, {
      userId,
      ...scoreData,
      reason: 'Calculated'
    });

    await client.query('COMMIT');

    return {
      userId,
      score: totalScore,
      scoreChange,
      breakdown: {
        paymentHistory: { score: paymentHistoryScore, weight: WEIGHTS.PAYMENT_HISTORY * 100 },
        disputeRatio: { score: disputeRatioScore, weight: WEIGHTS.DISPUTE_RATIO * 100 },
        kyc: { score: kycScore, weight: WEIGHTS.KYC * 100 },
        transactionVolume: { score: transactionVolumeScore, weight: WEIGHTS.TRANSACTION_VOLUME * 100 }
      },
      stats: {
        totalTransactions: paymentStats.total,
        completedPayments: paymentStats.completed,
        disputedPayments: disputeStats.disputed,
        disputeRatio: disputeStats.ratio,
        totalVolume: volumeStats.total,
        kycStatus: kycStatus.status
      }
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[CreditScoreService] Error calculating score:', error);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Get payment statistics for a user
 */
const getPaymentStats = async (client, userId) => {
  // Get invoices where user is seller (payments they should receive)
  const result = await client.query(
    `SELECT 
       COUNT(*) as total,
       COUNT(CASE WHEN status = 'completed' OR status = 'paid' THEN 1 END) as completed
     FROM invoices 
     WHERE seller_id = $1`,
    [userId]
  );
  
  const row = result.rows[0];
  return {
    total: parseInt(row.total) || 0,
    completed: parseInt(row.completed) || 0
  };
};

/**
 * Get dispute statistics for a user
 */
const getDisputeStats = async (client, userId) => {
  // Get invoices where user is seller and has disputes
  const result = await client.query(
    `SELECT 
       COUNT(i.id) as total_invoices,
       COUNT(d.id) as disputed
     FROM invoices i
     LEFT JOIN disputes d ON d.invoice_id = i.id
     WHERE i.seller_id = $1`,
    [userId]
  );
  
  const row = result.rows[0];
  const totalInvoices = parseInt(row.total_invoices) || 0;
  const disputed = parseInt(row.disputed) || 0;
  
  return {
    total: totalInvoices,
    disputed,
    ratio: totalInvoices > 0 ? disputed / totalInvoices : 0
  };
};

/**
 * Get KYC status for a user
 */
const getKycStatus = async (client, userId) => {
  const result = await client.query(
    'SELECT kyc_status, kyc_risk_level FROM users WHERE id = $1',
    [userId]
  );
  
  if (result.rows.length === 0) {
    return { status: 'none', riskLevel: 'unknown' };
  }
  
  return {
    status: result.rows[0].kyc_status || 'none',
    riskLevel: result.rows[0].kyc_risk_level || 'unknown'
  };
};

/**
 * Get transaction volume for a user
 */
const getTransactionVolume = async (client, userId) => {
  // Sum of all invoice amounts where user is seller
  const result = await client.query(
    `SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total
     FROM invoices 
     WHERE seller_id = $1 AND status IN ('completed', 'paid')`,
    [userId]
  );
  
  return {
    total: result.rows[0].total || '0'
  };
};

/**
 * Calculate payment history score (0-100)
 * Based on completion rate
 */
const calculatePaymentHistoryScore = (stats) => {
  if (stats.total === 0) {
    // New user with no transactions - give neutral score
    return 50;
  }
  
  const completionRate = stats.completed / stats.total;
  
  // Score based on completion rate
  // 100% completion = 100, 0% = 0
  return Math.round(completionRate * 100);
};

/**
 * Calculate dispute ratio score (0-100)
 * Lower dispute ratio = higher score
 */
const calculateDisputeRatioScore = (stats) => {
  if (stats.total === 0) {
    // No invoices, no disputes - give benefit of doubt
    return 75;
  }
  
  // Inverse ratio - higher disputes = lower score
  const noDisputeRate = 1 - stats.ratio;
  return Math.round(noDisputeRate * 100);
};

/**
 * Calculate KYC score (0-100)
 */
const calculateKycScore = (kycStatus) => {
  switch (kycStatus.status) {
    case 'verified':
      return kycStatus.riskLevel === 'low' ? 100 : 60;
    case 'pending':
      return 40;
    case 'rejected':
      return 0;
    default: // 'none' or unknown
      return 20;
  }
};

/**
 * Calculate transaction volume score (0-100)
 * Based on volume tiers
 */
const calculateVolumeScore = (volumeStats) => {
  const volume = parseFloat(volumeStats.total) || 0;
  
  // Tier-based scoring
  if (volume === 0) return 20;       // No volume - minimal score
  if (volume < 1000) return 40;      // Low volume
  if (volume < 10000) return 60;     // Medium volume  
  if (volume < 50000) return 80;    // High volume
  return 100;                        // Very high volume
};

/**
 * Upsert credit score record
 */
const upsertCreditScore = async (client, data) => {
  await client.query(
    `INSERT INTO credit_scores (
      user_id, score, payment_history_score, dispute_ratio_score, 
      kyc_score, transaction_volume_score, previous_score, score_change,
      total_transactions, completed_payments, disputed_payments,
      total_volume, kyc_status, last_calculated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      score = EXCLUDED.score,
      payment_history_score = EXCLUDED.payment_history_score,
      dispute_ratio_score = EXCLUDED.dispute_ratio_score,
      kyc_score = EXCLUDED.kyc_score,
      transaction_volume_score = EXCLUDED.transaction_volume_score,
      previous_score = EXCLUDED.previous_score,
      score_change = EXCLUDED.score_change,
      total_transactions = EXCLUDED.total_transactions,
      completed_payments = EXCLUDED.completed_payments,
      disputed_payments = EXCLUDED.disputed_payments,
      total_volume = EXCLUDED.total_volume,
      kyc_status = EXCLUDED.kyc_status,
      last_calculated_at = NOW(),
      updated_at = NOW()`,
    [
      data.userId,
      data.score,
      data.paymentHistoryScore,
      data.disputeRatioScore,
      data.kycScore,
      data.transactionVolumeScore,
      data.previousScore,
      data.scoreChange,
      data.totalTransactions,
      data.completedPayments,
      data.disputedPayments,
      data.totalVolume,
      data.kycStatus
    ]
  );
};

/**
 * Record score in history table
 */
const recordScoreHistory = async (client, data) => {
  await client.query(
    `INSERT INTO credit_score_history (
      user_id, score, score_change, payment_history_score,
      dispute_ratio_score, kyc_score, transaction_volume_score, reason
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      data.userId,
      data.score,
      data.scoreChange,
      data.paymentHistoryScore,
      data.disputeRatioScore,
      data.kycScore,
      data.transactionVolumeScore,
      data.reason
    ]
  );
};

/**
 * Get credit score by user ID
 */
const getScoreByUserId = async (userId) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credit_scores WHERE user_id = $1`,
      [userId]
    );
    
    if (result.rows.length === 0) {
      // Calculate score if not exists
      return await calculateScore(userId);
    }
    
    const score = result.rows[0];
    return {
      userId: score.user_id,
      score: score.score,
      scoreChange: score.score_change,
      breakdown: {
        paymentHistory: { score: score.payment_history_score, weight: WEIGHTS.PAYMENT_HISTORY * 100 },
        disputeRatio: { score: score.dispute_ratio_score, weight: WEIGHTS.DISPUTE_RATIO * 100 },
        kyc: { score: score.kyc_score, weight: WEIGHTS.KYC * 100 },
        transactionVolume: { score: score.transaction_volume_score, weight: WEIGHTS.TRANSACTION_VOLUME * 100 }
      },
      stats: {
        totalTransactions: score.total_transactions,
        completedPayments: score.completed_payments,
        disputedPayments: score.disputed_payments,
        totalVolume: score.total_volume,
        kycStatus: score.kyc_status,
        lastCalculatedAt: score.last_calculated_at
      }
    };
  } catch (error) {
    console.error('[CreditScoreService] Error getting score:', error);
    throw error;
  }
};

/**
 * Get score history for a user
 */
const getScoreHistory = async (userId, limit = 10) => {
  try {
    const result = await pool.query(
      `SELECT * FROM credit_score_history 
       WHERE user_id = $1 
       ORDER BY calculated_at DESC 
       LIMIT $2`,
      [userId, limit]
    );
    
    return result.rows;
  } catch (error) {
    console.error('[CreditScoreService] Error getting score history:', error);
    throw error;
  }
};

/**
 * Recalculate all user scores (for batch processing)
 */
const recalculateAllScores = async () => {
  try {
    // Get all users with credit scores
    const result = await pool.query(
      'SELECT DISTINCT user_id FROM credit_scores'
    );
    
    const results = [];
    for (const row of result.rows) {
      try {
        const score = await calculateScore(row.user_id);
        results.push({ userId: row.user_id, success: true, score: score.score });
      } catch (error) {
        results.push({ userId: row.user_id, success: false, error: error.message });
      }
    }
    
    return results;
  } catch (error) {
    console.error('[CreditScoreService] Error recalculating all scores:', error);
    throw error;
  }
};

/**
 * Get score tiers/grades
 */
const getScoreGrade = (score) => {
  if (score >= 90) return { grade: 'A', label: 'Excellent', color: 'green' };
  if (score >= 80) return { grade: 'B', label: 'Very Good', color: 'blue' };
  if (score >= 70) return { grade: 'C', label: 'Good', color: 'yellow' };
  if (score >= 60) return { grade: 'D', label: 'Fair', color: 'orange' };
  return { grade: 'F', label: 'Poor', color: 'red' };
};

module.exports = {
  calculateScore,
  getScoreByUserId,
  getScoreHistory,
  recalculateAllScores,
  getScoreGrade,
  WEIGHTS
};
