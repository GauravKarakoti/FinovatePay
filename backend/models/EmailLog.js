const { pool } = require('../config/database');

class EmailLog {
  /**
   * Find email log by ID
   * @param {string} id - Email ID
   * @returns {object} - Email log object or null
   */
  static async findById(id) {
    try {
      const query = 'SELECT * FROM email_logs WHERE id = $1';
      const result = await pool.query(query, [id]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Error finding email log:', error.message);
      return null;
    }
  }

  /**
   * Find email logs by status
   * @param {string} status - Email status
   * @param {integer} limit - Number of records to return
   * @returns {array} - Array of email logs
   */
  static async findByStatus(status, limit = 50) {
    try {
      const query = `
        SELECT * FROM email_logs
        WHERE status = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
      const result = await pool.query(query, [status, limit]);
      return result.rows;
    } catch (error) {
      console.error('❌ Error finding email logs by status:', error.message);
      return [];
    }
  }

  /**
   * Get email statistics
   * @returns {array} - Statistics by status
   */
  static async getStats() {
    try {
      const query = `
        SELECT
          status,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM email_logs), 2) as percentage
        FROM email_logs
        GROUP BY status
      `;
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ Error getting email stats:', error.message);
      return [];
    }
  }

  /**
   * Get total email count
   * @returns {integer} - Total count
   */
  static async getTotalCount() {
    try {
      const query = 'SELECT COUNT(*) as total FROM email_logs';
      const result = await pool.query(query);
      return parseInt(result.rows[0].total);
    } catch (error) {
      console.error('❌ Error getting total count:', error.message);
      return 0;
    }
  }
}

module.exports = EmailLog;
