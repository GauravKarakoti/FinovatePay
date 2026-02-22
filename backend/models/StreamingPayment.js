const { pool } = require('../config/database');

class StreamingPayment {
  /*//////////////////////////////////////////////////////////////
                          CREATE
  //////////////////////////////////////////////////////////////*/
  static async create(streamData) {
    const {
      streamId,
      sellerAddress,
      buyerAddress,
      amount,
      perIntervalAmount,
      tokenAddress,
      intervalType,
      description,
      totalIntervals,
      streamTxHash
    } = streamData;

    const query = `
      INSERT INTO streaming_payments (
        stream_id,
        seller_address,
        buyer_address,
        amount,
        per_interval_amount,
        token_address,
        interval_type,
        status,
        description,
        total_intervals,
        stream_tx_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10)
      RETURNING *
    `;

    const values = [
      streamId,
      sellerAddress,
      buyerAddress,
      amount.toString(),
      perIntervalAmount.toString(),
      tokenAddress,
      intervalType,
      description,
      totalIntervals,
      streamTxHash || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                        STATUS UPDATES
  //////////////////////////////////////////////////////////////*/
  static async updateStatus(streamId, status, additionalFields = {}) {
    const updates = ['status = $2'];
    const values = [streamId, status];
    let paramIndex = 3;

    if (additionalFields.startTime) {
      updates.push(`start_time = $${paramIndex++}`);
      values.push(additionalFields.startTime);
    }
    if (additionalFields.nextReleaseTime) {
      updates.push(`next_release_time = $${paramIndex++}`);
      values.push(additionalFields.nextReleaseTime);
    }
    if (additionalFields.totalReleased) {
      updates.push(`total_released = $${paramIndex++}`);
      values.push(additionalFields.totalReleased.toString());
    }
    if (additionalFields.totalPaid) {
      updates.push(`total_paid = $${paramIndex++}`);
      values.push(additionalFields.totalPaid.toString());
    }
    if (additionalFields.intervalsCompleted !== undefined) {
      updates.push(`intervals_completed = $${paramIndex++}`);
      values.push(additionalFields.intervalsCompleted);
    }
    if (additionalFields.streamTxHash) {
      updates.push(`stream_tx_hash = $${paramIndex++}`);
      values.push(additionalFields.streamTxHash);
    }

    const query = `
      UPDATE streaming_payments
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE stream_id = $1
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async incrementReleased(streamId, amount, intervalsCompleted) {
    const query = `
      UPDATE streaming_payments
      SET total_released = total_released::numeric + $2,
          intervals_completed = $3,
          updated_at = NOW()
      WHERE stream_id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [streamId, amount.toString(), intervalsCompleted]);
    return result.rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                          READ QUERIES
  //////////////////////////////////////////////////////////////*/
  static async findBySeller(address) {
    const query = `
      SELECT *
      FROM streaming_payments
      WHERE seller_address = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [address]);
    return rows;
  }

  static async findByBuyer(address) {
    const query = `
      SELECT *
      FROM streaming_payments
      WHERE buyer_address = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [address]);
    return rows;
  }

  static async findById(streamId) {
    const query = `
      SELECT *
      FROM streaming_payments
      WHERE stream_id = $1
    `;
    const { rows } = await pool.query(query, [streamId]);
    return rows[0];
  }

  static async findAll(filters = {}) {
    let query = `
      SELECT *
      FROM streaming_payments
      WHERE 1=1
    `;
    const values = [];
    let paramIndex = 1;

    if (filters.status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(filters.status);
    }
    if (filters.sellerAddress) {
      query += ` AND seller_address = $${paramIndex++}`;
      values.push(filters.sellerAddress);
    }
    if (filters.buyerAddress) {
      query += ` AND buyer_address = $${paramIndex++}`;
      values.push(filters.buyerAddress);
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    const { rows } = await pool.query(query, values);
    return rows;
  }

  static async getActiveStreams() {
    const query = `
      SELECT *
      FROM streaming_payments
      WHERE status = 'active'
      ORDER BY next_release_time ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  static async getStreamsReadyForRelease() {
    const query = `
      SELECT *
      FROM streaming_payments
      WHERE status = 'active'
        AND next_release_time <= NOW()
        AND total_released::numeric < amount::numeric
    `;
    const { rows } = await pool.query(query);
    return rows;
  }
}

module.exports = StreamingPayment;
