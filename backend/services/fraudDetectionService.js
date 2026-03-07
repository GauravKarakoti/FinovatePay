const { pool } = require('../config/database');
const FraudDetection = require('../models/FraudDetection');

const RISK_THRESHOLDS = {
  BLOCK: 85,
  ALERT: 60,
  REVIEW: 40
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampRisk = (risk) => {
  if (risk < 0) return 0;
  if (risk > 100) return 100;
  return Math.round(risk);
};

const getRiskLevel = (riskScore) => {
  if (riskScore >= 85) return 'critical';
  if (riskScore >= 70) return 'high';
  if (riskScore >= 45) return 'medium';
  return 'low';
};

const buildSummary = ({ riskScore, reasons }) => {
  return {
    riskScore,
    riskLevel: getRiskLevel(riskScore),
    reasons,
    shouldBlock: riskScore >= RISK_THRESHOLDS.BLOCK,
    shouldAlert: riskScore >= RISK_THRESHOLDS.ALERT,
    shouldReview: riskScore >= RISK_THRESHOLDS.REVIEW
  };
};

const evaluateTransactionRisk = async ({
  userId,
  walletAddress,
  invoiceId,
  transactionType,
  amount,
  currency,
  context = {}
}) => {
  const client = await pool.connect();

  try {
    const numericAmount = toNumber(amount);
    const normalizedType = transactionType || 'unknown';

    const [patterns, stats] = await Promise.all([
      FraudDetection.getActivePatterns(client),
      FraudDetection.getUserRecentStats({ userId, walletAddress, windowDays: 30 }, client)
    ]);

    const rapidTxCount = await FraudDetection.getRapidWindowCount({ userId, walletAddress, minutes: 15 }, client);

    let riskScore = 0;
    const reasonCodes = [];
    const reasons = [];
    const activatedPatterns = [];

    const avgAmount = toNumber(stats.avg_amount);
    const txCount = parseInt(stats.tx_count, 10) || 0;

    const patternMap = Object.fromEntries(patterns.map((pattern) => [pattern.pattern_key, pattern]));

    const addReason = (code, message, scoreDelta, patternKey) => {
      riskScore += scoreDelta;
      reasonCodes.push(code);
      reasons.push(message);
      if (patternKey && patternMap[patternKey]) {
        activatedPatterns.push(patternKey);
      }
    };

    const highAmountPattern = patternMap.high_amount_spike;
    const amountRatio = avgAmount > 0 ? numericAmount / avgAmount : 1;
    if (numericAmount > 0 && (numericAmount >= 50000 || amountRatio >= (toNumber(highAmountPattern?.threshold) || 2.5))) {
      addReason(
        'HIGH_AMOUNT_SPIKE',
        `Amount ${numericAmount} exceeds expected baseline (ratio ${amountRatio.toFixed(2)}).`,
        35,
        'high_amount_spike'
      );
    }

    const rapidPattern = patternMap.rapid_repeat_transactions;
    const rapidThreshold = Math.max(2, Math.round(toNumber(rapidPattern?.threshold) || 3));
    if (rapidTxCount >= rapidThreshold) {
      addReason(
        'RAPID_REPEAT_TRANSACTIONS',
        `${rapidTxCount} recent transactions detected in short window.`,
        25,
        'rapid_repeat_transactions'
      );
    }

    const kycStatus = String(context.kycStatus || '').toLowerCase();
    if (kycStatus && kycStatus !== 'verified') {
      addReason(
        'KYC_MISMATCH_RISK',
        `User KYC status is ${kycStatus}.`,
        30,
        'kyc_mismatch_risk'
      );
    }

    const hour = new Date().getUTCHours();
    if (hour <= 5) {
      addReason(
        'OFF_HOURS_ACTIVITY',
        'Transaction attempted during low-activity hours (UTC).',
        10,
        'off_hours_activity'
      );
    }

    if (normalizedType === 'invoice_create' && numericAmount > 100000) {
      addReason(
        'NEW_COUNTERPARTY_HIGH_VALUE',
        'High-value invoice creation requires review.',
        18,
        'new_counterparty_high_value'
      );
    }

    if (txCount === 0 && numericAmount > 10000) {
      addReason(
        'NEW_ACCOUNT_HIGH_VALUE',
        'High-value transaction on low-history account.',
        15,
        'new_counterparty_high_value'
      );
    }

    riskScore = clampRisk(riskScore);

    const summary = buildSummary({ riskScore, reasons });

    const suspiciousTransaction = await FraudDetection.createSuspiciousTransaction(
      {
        invoiceId,
        userId,
        walletAddress,
        transactionType: normalizedType,
        amount: numericAmount,
        currency,
        riskScore: summary.riskScore,
        riskLevel: summary.riskLevel,
        status: summary.shouldBlock ? 'blocked' : summary.shouldAlert ? 'under_review' : 'flagged',
        reasonCodes,
        features: {
          avgAmount,
          txCount,
          rapidTxCount,
          amountRatio,
          activatedPatterns
        },
        context
      },
      client
    );

    let alert = null;
    if (summary.shouldAlert) {
      alert = await FraudDetection.createAlert(
        {
          suspiciousTransactionId: suspiciousTransaction.id,
          alertCode: 'FRAUD_RISK_DETECTED',
          title: `${summary.riskLevel.toUpperCase()} fraud risk detected`,
          description: reasons.join(' '),
          severity: summary.riskLevel,
          metadata: {
            transactionType: normalizedType,
            invoiceId: invoiceId || null,
            activatedPatterns
          }
        },
        client
      );
    }

    return {
      ...summary,
      suspiciousTransaction,
      alert
    };
  } catch (error) {
    console.error('[FraudDetectionService] Error evaluating transaction risk:', error);
    throw error;
  } finally {
    client.release();
  }
};

const ensureTransactionAllowed = (riskResult) => {
  if (riskResult.shouldBlock) {
    const error = new Error('Transaction blocked by fraud detection policy');
    error.statusCode = 403;
    error.code = 'FRAUD_BLOCKED';
    error.details = {
      riskScore: riskResult.riskScore,
      riskLevel: riskResult.riskLevel,
      reasons: riskResult.reasons
    };
    throw error;
  }
};

const listAlerts = async ({ status, severity, limit, offset }) => {
  return FraudDetection.listAlerts({ status, severity, limit, offset });
};

const updateAlertStatus = async ({ alertId, status, resolvedBy, resolutionNote }) => {
  const allowed = new Set(['open', 'investigating', 'resolved', 'dismissed']);
  if (!allowed.has(status)) {
    const error = new Error('Invalid alert status');
    error.statusCode = 400;
    throw error;
  }

  const updated = await FraudDetection.updateAlertStatus({
    alertId,
    status,
    resolvedBy,
    resolutionNote
  });

  if (!updated) {
    const error = new Error('Alert not found');
    error.statusCode = 404;
    throw error;
  }

  return updated;
};

const getDashboardSummary = async () => {
  const client = await pool.connect();
  try {
    const [counts, highestRisk] = await Promise.all([
      client.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'open') AS open_alerts,
           COUNT(*) FILTER (WHERE status = 'investigating') AS investigating_alerts,
           COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_alerts,
           COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed_alerts
         FROM fraud_alerts`
      ),
      client.query(
        `SELECT
           id,
           transaction_type,
           amount,
           currency,
           risk_score,
           risk_level,
           created_at
         FROM suspicious_transactions
         ORDER BY risk_score DESC, created_at DESC
         LIMIT 5`
      )
    ]);

    return {
      alerts: counts.rows[0],
      highestRiskTransactions: highestRisk.rows
    };
  } finally {
    client.release();
  }
};

module.exports = {
  RISK_THRESHOLDS,
  evaluateTransactionRisk,
  ensureTransactionAllowed,
  listAlerts,
  updateAlertStatus,
  getDashboardSummary
};
