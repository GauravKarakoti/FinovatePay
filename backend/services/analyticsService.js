const { pool } = require('../config/database');

/**
 * Analytics Service
 * Provides real-time financial analytics including cash flow visualization,
 * payment history, financing metrics, and risk assessment scores.
 */

/**
 * Get payment analytics for a user
 * @param {string} userId - The user ID
 * @returns {Object} Payment analytics including totals and volume trends
 */
async function getPaymentAnalytics(userId) {
  try {
    // Get total payments count and volume
    const totalPaymentsQuery = `
      SELECT 
        COUNT(*) as total_payments,
        COALESCE(SUM(amount), 0) as total_volume,
        COALESCE(AVG(amount), 0) as average_amount
      FROM payments
      WHERE user_id = $1
    `;
    const totalResult = await pool.query(totalPaymentsQuery, [userId]);

    // Get payment volume by month (last 12 months)
    const monthlyVolumeQuery = `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as payment_count,
        COALESCE(SUM(amount), 0) as volume
      FROM payments
      WHERE user_id = $1 
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `;
    const monthlyResult = await pool.query(monthlyVolumeQuery, [userId]);

    // Get payment status distribution
    const statusQuery = `
      SELECT 
        status,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as amount
      FROM payments
      WHERE user_id = $1
      GROUP BY status
    `;
    const statusResult = await pool.query(statusQuery, [userId]);

    // Get recent payments
    const recentPaymentsQuery = `
      SELECT 
        p.*,
        i.invoice_id,
        i.description as invoice_description
      FROM payments p
      LEFT JOIN invoices i ON p.invoice_id = i.invoice_id
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT 10
    `;
    const recentResult = await pool.query(recentPaymentsQuery, [userId]);

    return {
      summary: {
        totalPayments: parseInt(totalResult.rows[0].total_payments) || 0,
        totalVolume: parseFloat(totalResult.rows[0].total_volume) || 0,
        averageAmount: parseFloat(totalResult.rows[0].average_amount) || 0
      },
      monthlyVolume: monthlyResult.rows,
      statusDistribution: statusResult.rows,
      recentPayments: recentResult.rows
    };
  } catch (error) {
    console.error('Error in getPaymentAnalytics:', error);
    throw error;
  }
}

/**
 * Get financing analytics for a user (seller/investor)
 * @param {string} userId - The user ID
 * @returns {Object} Financing analytics including ROI and outstanding amounts
 */
async function getFinancingAnalytics(userId) {
  try {
    // Get financing summary for seller
    const financingSummaryQuery = `
      SELECT 
        COUNT(*) as total_financed,
        COALESCE(SUM(amount), 0) as total_financed_amount,
        COUNT(CASE WHEN financing_status = 'listed' THEN 1 END) as currently_listed,
        COUNT(CASE WHEN financing_status = 'financed' THEN 1 END) as actively_financed,
        COUNT(CASE WHEN financing_status = 'repaid' THEN 1 END) as repaid
      FROM invoices
      WHERE seller_id = $1 AND is_tokenized = true
    `;
    const summaryResult = await pool.query(financingSummaryQuery, [userId]);

    // Get financing performance by month
    const monthlyFinancingQuery = `
      SELECT 
        TO_CHAR(created_at, 'YYYY-MM') as month,
        COUNT(*) as invoice_count,
        COALESCE(SUM(amount), 0) as amount
      FROM invoices
      WHERE seller_id = $1 
        AND is_tokenized = true
        AND created_at >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `;
    const monthlyResult = await pool.query(monthlyFinancingQuery, [userId]);

    // Get yield distribution for investors
    const yieldDistributionQuery = `
      SELECT 
        yield_bps,
        COUNT(*) as invoice_count,
        COALESCE(SUM(amount), 0) as total_amount
      FROM invoices
      WHERE is_tokenized = true AND yield_bps IS NOT NULL
      GROUP BY yield_bps
      ORDER BY yield_bps DESC
      LIMIT 10
    `;
    const yieldResult = await pool.query(yieldDistributionQuery);

    // Calculate estimated ROI (simplified calculation)
    const roiQuery = `
      SELECT 
        COALESCE(AVG(yield_bps), 0) as average_yield,
        COALESCE(SUM(amount * yield_bps / 10000), 0) as estimated_returns
      FROM invoices
      WHERE seller_id = $1 
        AND is_tokenized = true
        AND financing_status IN ('listed', 'financed')
    `;
    const roiResult = await pool.query(roiQuery, [userId]);

    return {
      summary: {
        totalFinanced: parseInt(summaryResult.rows[0].total_financed) || 0,
        totalFinancedAmount: parseFloat(summaryResult.rows[0].total_financed_amount) || 0,
        currentlyListed: parseInt(summaryResult.rows[0].currently_listed) || 0,
        activelyFinanced: parseInt(summaryResult.rows[0].actively_financed) || 0,
        repaid: parseInt(summaryResult.rows[0].repaid) || 0
      },
      monthlyFinancing: monthlyResult.rows,
      yieldDistribution: yieldResult.rows,
      roi: {
        averageYield: parseFloat(roiResult.rows[0].average_yield) || 0,
        estimatedReturns: parseFloat(roiResult.rows[0].estimated_returns) || 0
      }
    };
  } catch (error) {
    console.error('Error in getFinancingAnalytics:', error);
    throw error;
  }
}

/**
 * Calculate risk score for an invoice
 * @param {string} invoiceId - The invoice ID
 * @returns {Object} Risk assessment score and details
 */
async function getRiskScore(invoiceId) {
  try {
    // Get invoice details
    const invoiceQuery = `
      SELECT 
        i.*,
        u.payment_history_score,
        u.credit_score
      FROM invoices i
      LEFT JOIN users u ON i.seller_id = u.id
      WHERE i.invoice_id = $1
    `;
    const invoiceResult = await pool.query(invoiceQuery, [invoiceId]);

    if (invoiceResult.rows.length === 0) {
      throw new Error('Invoice not found');
    }

    const invoice = invoiceResult.rows[0];

    // Calculate risk score based on multiple factors
    let riskScore = 50; // Base score
    const riskFactors = [];

    // Factor 1: Invoice age and maturity
    const daysUntilMaturity = Math.floor(
      (new Date(invoice.maturity_date) - new Date()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysUntilMaturity < 0) {
      riskScore += 30;
      riskFactors.push({
        factor: 'Overdue',
        impact: 'high',
        description: 'Invoice is past maturity date'
      });
    } else if (daysUntilMaturity < 7) {
      riskScore += 15;
      riskFactors.push({
        factor: 'Due Soon',
        impact: 'medium',
        description: `Due in ${daysUntilMaturity} days`
      });
    } else if (daysUntilMaturity < 30) {
      riskScore += 5;
      riskFactors.push({
        factor: 'Maturity',
        impact: 'low',
        description: `Due in ${daysUntilMaturity} days`
      });
    }

    // Factor 2: Financing status
    if (invoice.financing_status === 'financed') {
      riskScore -= 10;
      riskFactors.push({
        factor: 'Financing Active',
        impact: 'low',
        description: 'Invoice has active financing'
      });
    } else if (invoice.financing_status === 'listed') {
      riskScore -= 5;
      riskFactors.push({
        factor: 'Listed',
        impact: 'low',
        description: 'Invoice is listed on marketplace'
      });
    }

    // Factor 3: User credit score if available
    if (invoice.credit_score) {
      if (invoice.credit_score < 500) {
        riskScore += 25;
        riskFactors.push({
          factor: 'Low Credit Score',
          impact: 'high',
          description: `Seller credit score: ${invoice.credit_score}`
        });
      } else if (invoice.credit_score < 700) {
        riskScore += 10;
        riskFactors.push({
          factor: 'Medium Credit Score',
          impact: 'medium',
          description: `Seller credit score: ${invoice.credit_score}`
        });
      } else {
        riskScore -= 15;
        riskFactors.push({
          factor: 'Good Credit Score',
          impact: 'low',
          description: `Seller credit score: ${invoice.credit_score}`
        });
      }
    }

    // Factor 4: Payment history
    if (invoice.payment_history_score) {
      if (invoice.payment_history_score < 50) {
        riskScore += 20;
        riskFactors.push({
          factor: 'Poor Payment History',
          impact: 'high',
          description: 'Seller has poor payment history'
        });
      } else if (invoice.payment_history_score < 75) {
        riskScore += 5;
        riskFactors.push({
          factor: 'Fair Payment History',
          impact: 'medium',
          description: 'Seller has fair payment history'
        });
      } else {
        riskScore -= 15;
        riskFactors.push({
          factor: 'Good Payment History',
          impact: 'low',
          description: 'Seller has good payment history'
        });
      }
    }

    // Factor 5: Invoice amount (larger invoices = higher risk)
    const amount = parseFloat(invoice.amount);
    if (amount > 100000) {
      riskScore += 10;
      riskFactors.push({
        factor: 'High Value',
        impact: 'medium',
        description: `Large invoice amount: $${amount.toLocaleString()}`
      });
    }

    // Clamp risk score between 0 and 100
    riskScore = Math.max(0, Math.min(100, riskScore));

    // Determine risk level
    let riskLevel;
    if (riskScore >= 70) {
      riskLevel = 'high';
    } else if (riskScore >= 40) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    // Get historical payment data for this seller
    const sellerHistoryQuery = `
      SELECT 
        COUNT(*) as total_payments,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COALESCE(AVG(amount), 0) as avg_amount
      FROM payments
      WHERE user_id = $1
    `;
    const historyResult = await pool.query(sellerHistoryQuery, [invoice.seller_id]);

    const paymentHistory = {
      totalPayments: parseInt(historyResult.rows[0].total_payments) || 0,
      completed: parseInt(historyResult.rows[0].completed) || 0,
      failed: parseInt(historyResult.rows[0].failed) || 0,
      averageAmount: parseFloat(historyResult.rows[0].avg_amount) || 0
    };

    return {
      invoiceId,
      riskScore,
      riskLevel,
      riskFactors,
      invoiceDetails: {
        amount: invoice.amount,
        currency: invoice.currency,
        maturityDate: invoice.maturity_date,
        financingStatus: invoice.financing_status,
        status: invoice.status
      },
      paymentHistory,
      recommendation: getRecommendation(riskLevel, riskScore)
    };
  } catch (error) {
    console.error('Error in getRiskScore:', error);
    throw error;
  }
}

/**
 * Get recommendation based on risk level
 */
function getRecommendation(riskLevel, riskScore) {
  if (riskLevel === 'low') {
    return {
      action: 'invest',
      message: 'This invoice presents low risk. Consider investing for stable returns.'
    };
  } else if (riskLevel === 'medium') {
    return {
      action: 'caution',
      message: 'This invoice presents moderate risk. Conduct additional due diligence before investing.'
    };
  } else {
    return {
      action: 'avoid',
      message: 'This invoice presents high risk. Consider avoiding or requesting additional collateral.'
    };
  }
}

/**
 * Get dashboard overview - summary of all analytics
 * @param {string} userId - The user ID
 * @param {string} role - The user role
 * @returns {Object} Dashboard overview
 */
async function getDashboardOverview(userId, role) {
  try {
    const overview = {
      timestamp: new Date().toISOString(),
      role
    };

    if (role === 'seller') {
      // Get invoice statistics
      const invoiceStatsQuery = `
        SELECT 
          COUNT(*) as total_invoices,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputed,
          COALESCE(SUM(amount), 0) as total_amount,
          COUNT(CASE WHEN is_tokenized = true THEN 1 END) as tokenized
        FROM invoices
        WHERE seller_id = $1
      `;
      const invoiceStats = await pool.query(invoiceStatsQuery, [userId]);

      // Get escrow statistics
      const escrowStatsQuery = `
        SELECT 
          COUNT(*) as total_escrows,
          COUNT(CASE WHEN escrow_status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN escrow_status = 'released' THEN 1 END) as released,
          COUNT(CASE WHEN escrow_status = 'disputed' THEN 1 END) as disputed,
          COALESCE(SUM(amount), 0) as total_escrowed
        FROM invoices
        WHERE seller_id = $1 AND escrow_status IS NOT NULL
      `;
      const escrowStats = await pool.query(escrowStatsQuery, [userId]);

      overview.invoices = {
        total: parseInt(invoiceStats.rows[0].total_invoices) || 0,
        completed: parseInt(invoiceStats.rows[0].completed) || 0,
        pending: parseInt(invoiceStats.rows[0].pending) || 0,
        disputed: parseInt(invoiceStats.rows[0].disputed) || 0,
        totalAmount: parseFloat(invoiceStats.rows[0].total_amount) || 0,
        tokenized: parseInt(invoiceStats.rows[0].tokenized) || 0
      };

      overview.escrow = {
        total: parseInt(escrowStats.rows[0].total_escrows) || 0,
        active: parseInt(escrowStats.rows[0].active) || 0,
        released: parseInt(escrowStats.rows[0].released) || 0,
        disputed: parseInt(escrowStats.rows[0].disputed) || 0,
        totalEscrowed: parseFloat(escrowStats.rows[0].total_escrowed) || 0
      };

      // Get financing data
      const financingData = await getFinancingAnalytics(userId);
      overview.financing = financingData.summary;

    } else if (role === 'investor') {
      // Get marketplace statistics for investors
      const marketplaceQuery = `
        SELECT 
          COUNT(*) as total_listed,
          COALESCE(SUM(amount), 0) as total_value,
          COUNT(CASE WHEN financing_status = 'listed' THEN 1 END) as available,
          COUNT(CASE WHEN financing_status = 'financed' THEN 1 END) as financed,
          COALESCE(AVG(yield_bps), 0) as average_yield
        FROM invoices
        WHERE is_tokenized = true
      `;
      const marketplaceStats = await pool.query(marketplaceQuery);

      overview.marketplace = {
        totalListed: parseInt(marketplaceStats.rows[0].total_listed) || 0,
        totalValue: parseFloat(marketplaceStats.rows[0].total_value) || 0,
        available: parseInt(marketplaceStats.rows[0].available) || 0,
        financed: parseInt(marketplaceStats.rows[0].financed) || 0,
        averageYield: parseFloat(marketplaceStats.rows[0].average_yield) || 0
      };

      // Get financing data
      const financingData = await getFinancingAnalytics(userId);
      overview.financing = financingData.summary;

    } else if (role === 'buyer') {
      // Get payment statistics for buyers
      const paymentStatsQuery = `
        SELECT 
          COUNT(*) as total_payments,
          COALESCE(SUM(amount), 0) as total_spent,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
        FROM payments
        WHERE user_id = $1
      `;
      const paymentStats = await pool.query(paymentStatsQuery, [userId]);

      overview.payments = {
        total: parseInt(paymentStats.rows[0].total_payments) || 0,
        totalSpent: parseFloat(paymentStats.rows[0].total_spent) || 0,
        completed: parseInt(paymentStats.rows[0].completed) || 0,
        pending: parseInt(paymentStats.rows[0].pending) || 0
      };
    }

    return overview;
  } catch (error) {
    console.error('Error in getDashboardOverview:', error);
    throw error;
  }
}

module.exports = {
  getPaymentAnalytics,
  getFinancingAnalytics,
  getRiskScore,
  getDashboardOverview
};
