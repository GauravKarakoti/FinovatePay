const { pool } = require('../config/database');

/**
 * CreditRiskProfile Model
 * Represents AI/ML-based credit risk assessments
 */
class CreditRiskProfile {
  static async findByUserId(userId) {
    try {
      const result = await pool.query(
        `SELECT 
          crp.*,
          cs.score as traditional_score
         FROM credit_risk_profiles crp
         LEFT JOIN credit_scores cs ON crp.credit_score_id = cs.id
         WHERE crp.user_id = $1`,
        [userId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('[CreditRiskProfile] Error finding profile:', error);
      throw error;
    }
  }

  /**
   * Find risk profile with factors by user ID
   */
  static async findByUserIdWithFactors(userId) {
    try {
      const profile = await this.findByUserId(userId);
      
      if (!profile) {
        return null;
      }

      // Get risk factors
      const factorsResult = await pool.query(
        `SELECT * FROM credit_risk_factors 
         WHERE risk_profile_id = $1 
         ORDER BY factor_weight DESC`,
        [profile.id]
      );

      return {
        ...profile,
        factors: factorsResult.rows
      };
    } catch (error) {
      console.error('[CreditRiskProfile] Error finding profile with factors:', error);
      throw error;
    }
  }

  /**
   * Create or update risk profile
   */
  static async upsert(userId, data) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get credit score ID if available
      const creditScoreResult = await client.query(
        'SELECT id FROM credit_scores WHERE user_id = $1',
        [userId]
      );
      const creditScoreId = creditScoreResult.rows[0]?.id || null;

      // Determine risk category
      const riskCategory = this.getRiskCategory(data.risk_score);

      // Calculate dynamic rate
      const dynamicRate = this.calculateDynamicRate(
        data.base_rate || 5.00,
        data.risk_adjustment || 0.00
      );

      const result = await client.query(
        `INSERT INTO credit_risk_profiles (
          user_id,
          behavioral_score,
          payment_velocity_score,
          market_alignment_score,
          financial_health_score,
          risk_score,
          previous_risk_score,
          risk_change,
          risk_category,
          base_rate,
          risk_adjustment,
          dynamic_rate,
          behavioral_features,
          payment_pattern_features,
          market_features,
          model_version,
          model_confidence,
          credit_score_id,
          last_calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          behavioral_score = EXCLUDED.behavioral_score,
          payment_velocity_score = EXCLUDED.payment_velocity_score,
          market_alignment_score = EXCLUDED.market_alignment_score,
          financial_health_score = EXCLUDED.financial_health_score,
          risk_score = EXCLUDED.risk_score,
          previous_risk_score = EXCLUDED.previous_risk_score,
          risk_change = EXCLUDED.risk_change,
          risk_category = EXCLUDED.risk_category,
          base_rate = EXCLUDED.base_rate,
          risk_adjustment = EXCLUDED.risk_adjustment,
          dynamic_rate = EXCLUDED.dynamic_rate,
          behavioral_features = EXCLUDED.behavioral_features,
          payment_pattern_features = EXCLUDED.payment_pattern_features,
          market_features = EXCLUDED.market_features,
          model_version = EXCLUDED.model_version,
          model_confidence = EXCLUDED.model_confidence,
          credit_score_id = EXCLUDED.credit_score_id,
          last_calculated_at = NOW(),
          updated_at = NOW()
        RETURNING *`,
        [
          userId,
          data.behavioral_score,
          data.payment_velocity_score,
          data.market_alignment_score,
          data.financial_health_score,
          data.risk_score,
          data.previous_risk_score,
          data.risk_change,
          riskCategory,
          data.base_rate || 5.00,
          data.risk_adjustment || 0.00,
          dynamicRate,
          JSON.stringify(data.behavioral_features || {}),
          JSON.stringify(data.payment_pattern_features || {}),
          JSON.stringify(data.market_features || {}),
          data.model_version || 'v1.0',
          data.model_confidence || 0.75,
          creditScoreId
        ]
      );

      // Insert risk factors if provided
      if (data.factors && data.factors.length > 0) {
        // Delete existing factors
        await client.query(
          'DELETE FROM credit_risk_factors WHERE risk_profile_id = $1',
          [result.rows[0].id]
        );

        // Insert new factors
        for (const factor of data.factors) {
          await client.query(
            `INSERT INTO credit_risk_factors (
              risk_profile_id, factor_name, factor_category, factor_weight,
              factor_value, factor_impact, factor_description,
              benchmark_value, percentile_rank
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              result.rows[0].id,
              factor.factor_name,
              factor.factor_category,
              factor.factor_weight,
              factor.factor_value,
              factor.factor_impact,
              factor.factor_description,
              factor.benchmark_value,
              factor.percentile_rank
            ]
          );
        }
      }

      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[CreditRiskProfile] Error upserting profile:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record risk history
   */
  static async recordHistory(userId, data) {
    try {
      await pool.query(
        `INSERT INTO credit_risk_history (
          user_id, behavioral_score, payment_velocity_score, 
          market_alignment_score, financial_health_score,
          risk_score, risk_change, risk_category, dynamic_rate,
          trigger_event, trigger_description, features_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          userId,
          data.behavioral_score,
          data.payment_velocity_score,
          data.market_alignment_score,
          data.financial_health_score,
          data.risk_score,
          data.risk_change,
          data.risk_category,
          data.dynamic_rate,
          data.trigger_event,
          data.trigger_description,
          JSON.stringify(data.features || {})
        ]
      );
    } catch (error) {
      console.error('[CreditRiskProfile] Error recording history:', error);
      throw error;
    }
  }

  /**
   * Get risk history for a user
   */
  static async getHistory(userId, limit = 10) {
    try {
      const result = await pool.query(
        `SELECT * FROM credit_risk_history 
         WHERE user_id = $1 
         ORDER BY calculated_at DESC 
         LIMIT $2`,
        [userId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error('[CreditRiskProfile] Error getting history:', error);
      throw error;
    }
  }

  /**
   * Determine risk category based on score
   */
  static getRiskCategory(riskScore) {
    if (riskScore <= 20) return 'excellent';
    if (riskScore <= 35) return 'good';
    if (riskScore <= 50) return 'moderate';
    if (riskScore <= 70) return 'high';
    return 'very_high';
  }

  /**
   * Calculate dynamic interest rate
   */
  static calculateDynamicRate(baseRate, riskAdjustment) {
    const rate = parseFloat(baseRate) + parseFloat(riskAdjustment);
    // Cap rate between 0% and 30%
    return Math.max(0, Math.min(30, rate));
  }

  /**
   * Get all risk profiles (admin)
   */
  static async getAll(limit = 100, offset = 0) {
    try {
      const result = await pool.query(
        `SELECT crp.*, u.email, u.wallet_address, u.kyc_status
         FROM credit_risk_profiles crp
         JOIN users u ON crp.user_id = u.id
         ORDER BY crp.risk_score ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return result.rows;
    } catch (error) {
      console.error('[CreditRiskProfile] Error getting all profiles:', error);
      throw error;
    }
  }

  /**
   * Get risk profiles by category
   */
  static async getByCategory(category) {
    try {
      const result = await pool.query(
        `SELECT crp.*, u.email, u.wallet_address
         FROM credit_risk_profiles crp
         JOIN users u ON crp.user_id = u.id
         WHERE crp.risk_category = $1
         ORDER BY crp.risk_score ASC`,
        [category]
      );
      return result.rows;
    } catch (error) {
      console.error('[CreditRiskProfile] Error getting by category:', error);
      throw error;
    }
  }
}

module.exports = CreditRiskProfile;

