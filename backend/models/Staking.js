const { pool } = require('../config/database');

class Staking {
  static async createTableIfNotExists() {
    const query = `
      CREATE TABLE IF NOT EXISTS staking_positions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        token_address TEXT NOT NULL,
        token_id TEXT NOT NULL,
        amount NUMERIC NOT NULL,
        staking_start TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
        lock_until TIMESTAMP WITHOUT TIME ZONE,
        apy_bp INTEGER DEFAULT 0,
        last_claimed_at TIMESTAMP WITHOUT TIME ZONE,
        created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
      )
    `;
    await pool.query(query);
  }

  static async createStake({ userId, tokenAddress, tokenId, amount, lockUntil, apyBP }) {
    await this.createTableIfNotExists();
    const query = `
      INSERT INTO staking_positions (user_id, token_address, token_id, amount, lock_until, apy_bp)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `;
    const values = [userId, tokenAddress, tokenId, amount, lockUntil, apyBP];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async getUserStakes(userId) {
    await this.createTableIfNotExists();
    const query = `SELECT * FROM staking_positions WHERE user_id = $1 ORDER BY created_at DESC`;
    const { rows } = await pool.query(query, [userId]);
    return rows;
  }

  static async getById(id) {
    const query = `SELECT * FROM staking_positions WHERE id = $1`;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async markClaimed(id) {
    const query = `UPDATE staking_positions SET last_claimed_at = NOW() WHERE id = $1 RETURNING *`;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async remove(id) {
    const query = `DELETE FROM staking_positions WHERE id = $1 RETURNING *`;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }
}

module.exports = Staking;
