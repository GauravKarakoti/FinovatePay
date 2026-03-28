const { pool } = require('../config/database');

class FraudDetection {
  static async getActivePatterns(client = pool) {
    const result = await client.query(
      `SELECT *
       FROM fraud_patterns
       WHERE is_active = TRUE
       ORDER BY severity DESC, weight DESC`
    );
    return result.rows;
  }

  static async getUserRecentStats({ userId, walletAddress, windowDays = 30 }, client = pool) {
    const result = await client.query(
      `SELECT
         COUNT(*) AS tx_count,
         COALESCE(AVG(amount), 0) AS avg_amount,
         COALESCE(MAX(amount), 0) AS max_amount,
         COALESCE(SUM(amount), 0) AS total_amount
       FROM suspicious_transactions
       WHERE created_at >= NOW() - ($1::TEXT || ' days')::INTERVAL
         AND (
           ($2::UUID IS NOT NULL AND user_id = $2)
           OR ($3::TEXT IS NOT NULL AND LOWER(wallet_address) = LOWER($3))
         )`,
      [String(windowDays), userId || null, walletAddress || null]
    );

    return result.rows[0] || {
      tx_count: 0,
      avg_amount: 0,
      max_amount: 0,
      total_amount: 0
    };
  }

  static async getRapidWindowCount({ userId, walletAddress, minutes = 15 }, client = pool) {
    const result = await client.query(
      `SELECT COUNT(*) AS tx_count
       FROM suspicious_transactions
       WHERE created_at >= NOW() - ($1::TEXT || ' minutes')::INTERVAL
         AND (
           ($2::UUID IS NOT NULL AND user_id = $2)
           OR ($3::TEXT IS NOT NULL AND LOWER(wallet_address) = LOWER($3))
         )`,
      [String(minutes), userId || null, walletAddress || null]
    );

    return parseInt(result.rows[0]?.tx_count, 10) || 0;
  }

  static async createSuspiciousTransaction(payload, client = pool) {
    const result = await client.query(
      `INSERT INTO suspicious_transactions (
         invoice_id,
         user_id,
         wallet_address,
         transaction_type,
         amount,
         currency,
         risk_score,
         risk_level,
         status,
         detection_source,
         reason_codes,
         features,
         context
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb)
       RETURNING *`,
      [
        payload.invoiceId || null,
        payload.userId || null,
        payload.walletAddress || null,
        payload.transactionType,
        payload.amount || 0,
        payload.currency || null,
        payload.riskScore,
        payload.riskLevel,
        payload.status || 'flagged',
        payload.detectionSource || 'ml_service',
        payload.reasonCodes || [],
        JSON.stringify(payload.features || {}),
        JSON.stringify(payload.context || {})
      ]
    );

    return result.rows[0];
  }

  static async createAlert(payload, client = pool) {
    const result = await client.query(
      `INSERT INTO fraud_alerts (
         suspicious_transaction_id,
         alert_code,
         title,
         description,
         severity,
         status,
         assigned_to,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING *`,
      [
        payload.suspiciousTransactionId,
        payload.alertCode,
        payload.title,
        payload.description || null,
        payload.severity,
        payload.status || 'open',
        payload.assignedTo || null,
        JSON.stringify(payload.metadata || {})
      ]
    );

    return result.rows[0];
  }

  static async listAlerts({ status, severity, limit = 50, offset = 0 } = {}, client = pool) {
    const result = await client.query(
      `SELECT
         fa.*,
         st.transaction_type,
         st.amount,
         st.currency,
         st.risk_score,
         st.risk_level,
         st.reason_codes,
         st.wallet_address,
         st.invoice_id,
         st.user_id
       FROM fraud_alerts fa
       LEFT JOIN suspicious_transactions st ON st.id = fa.suspicious_transaction_id
       WHERE ($1::TEXT IS NULL OR fa.status = $1)
         AND ($2::TEXT IS NULL OR fa.severity = $2)
       ORDER BY fa.created_at DESC
       LIMIT $3 OFFSET $4`,
      [status || null, severity || null, limit, offset]
    );

    return result.rows;
  }

  static async getAlertById(alertId, client = pool) {
    const result = await client.query(
      `SELECT * FROM fraud_alerts WHERE id = $1`,
      [alertId]
    );
    return result.rows[0] || null;
  }

  static async updateAlertStatus({ alertId, status, resolvedBy, resolutionNote }, client = pool) {
    const shouldResolve = status === 'resolved' || status === 'dismissed';

    const result = await client.query(
      `UPDATE fraud_alerts
       SET
         status = $2,
         resolved_by = CASE WHEN $3::BOOLEAN THEN $4::UUID ELSE resolved_by END,
         resolved_at = CASE WHEN $3::BOOLEAN THEN NOW() ELSE resolved_at END,
         resolution_note = CASE WHEN $3::BOOLEAN THEN $5 ELSE resolution_note END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [alertId, status, shouldResolve, resolvedBy || null, resolutionNote || null]
    );

    return result.rows[0] || null;
  }
}

module.exports = FraudDetection;
