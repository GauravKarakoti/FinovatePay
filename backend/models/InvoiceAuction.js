const { pool } = require('../config/database');

class InvoiceAuction {
  /*//////////////////////////////////////////////////////////////
                          CREATE
  //////////////////////////////////////////////////////////////*/
  static async create(auctionData) {
    const {
      auctionId,
      sellerAddress,
      invoiceContractAddress,
      invoiceId,
      faceValue,
      paymentToken,
      minYieldBps,
      auctionEndTime,
      minBidIncrement,
      txHash
    } = auctionData;

    const query = `
      INSERT INTO invoice_auctions (
        auction_id,
        seller_address,
        invoice_contract_address,
        invoice_id,
        face_value,
        payment_token,
        min_yield_bps,
        auction_end_time,
        min_bid_increment,
        status,
        tx_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'created', $10)
      RETURNING *
    `;

    const values = [
      auctionId,
      sellerAddress,
      invoiceContractAddress || null,
      invoiceId,
      faceValue.toString(),
      paymentToken,
      minYieldBps,
      auctionEndTime,
      minBidIncrement?.toString() || '0',
      txHash || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                        STATUS UPDATES
  //////////////////////////////////////////////////////////////*/
  static async updateStatus(auctionId, status, additionalFields = {}) {
    const updates = ['status = $2'];
    const values = [auctionId, status];
    let paramIndex = 3;

    if (additionalFields.highestBid) {
      updates.push(`highest_bid = $${paramIndex++}`);
      values.push(additionalFields.highestBid.toString());
    }
    if (additionalFields.highestBidder) {
      updates.push(`highest_bidder = $${paramIndex++}`);
      values.push(additionalFields.highestBidder);
    }
    if (additionalFields.txHash) {
      updates.push(`tx_hash = $${paramIndex++}`);
      values.push(additionalFields.txHash);
    }
    if (additionalFields.winnerAddress) {
      updates.push(`winner_address = $${paramIndex++}`);
      values.push(additionalFields.winnerAddress);
    }
    if (additionalFields.winningYieldBps) {
      updates.push(`winning_yield_bps = $${paramIndex++}`);
      values.push(additionalFields.winningYieldBps);
    }
    if (additionalFields.platformFee) {
      updates.push(`platform_fee = $${paramIndex++}`);
      values.push(additionalFields.platformFee.toString());
    }

    const query = `
      UPDATE invoice_auctions
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE auction_id = $1
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                          BID OPERATIONS
  //////////////////////////////////////////////////////////////*/
  static async addBid(bidData) {
    const {
      bidId,
      auctionId,
      bidderAddress,
      yieldBps,
      bidAmount
    } = bidData;

    const query = `
      INSERT INTO auction_bids (
        bid_id,
        auction_id,
        bidder_address,
        yield_bps,
        bid_amount,
        status
      )
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING *
    `;

    const values = [
      bidId,
      auctionId,
      bidderAddress,
      yieldBps,
      bidAmount.toString()
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async updateBidStatus(bidId, status) {
    const query = `
      UPDATE auction_bids
      SET status = $2, updated_at = NOW()
      WHERE bid_id = $1
      RETURNING *
    `;
    const result = await pool.query(query, [bidId, status]);
    return result.rows[0];
  }

  static async markOtherBidsAsOutbid(auctionId, winningBidId) {
    const query = `
      UPDATE auction_bids
      SET status = 'outbid', updated_at = NOW()
      WHERE auction_id = $1 AND bid_id != $2 AND status = 'active'
      RETURNING *
    `;
    const result = await pool.query(query, [auctionId, winningBidId]);
    return result.rows;
  }

  /*//////////////////////////////////////////////////////////////
                          READ QUERIES
  //////////////////////////////////////////////////////////////*/
  static async findById(auctionId) {
    const query = `
      SELECT *
      FROM invoice_auctions
      WHERE auction_id = $1
    `;
    const { rows } = await pool.query(query, [auctionId]);
    return rows[0];
  }

  static async findBySeller(address) {
    const query = `
      SELECT *
      FROM invoice_auctions
      WHERE seller_address = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [address]);
    return rows;
  }

  static async findByInvoiceId(invoiceId) {
    const query = `
      SELECT *
      FROM invoice_auctions
      WHERE invoice_id = $1
      ORDER BY created_at DESC
    `;
    const { rows } = await pool.query(query, [invoiceId]);
    return rows;
  }

  static async findAll(filters = {}) {
    let query = `
      SELECT *
      FROM invoice_auctions
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
    if (filters.minYieldBps) {
      query += ` AND min_yield_bps <= $${paramIndex++}`;
      values.push(filters.minYieldBps);
    }

    // Filter by end time for active auctions
    if (filters.active) {
      query += ` AND status = 'active' AND auction_end_time > NOW()`;
    }

    query += ' ORDER BY created_at DESC';

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      values.push(filters.limit);
    }

    const { rows } = await pool.query(query, values);
    return rows;
  }

  static async findActiveAuctions(limit = 50) {
    const query = `
      SELECT *
      FROM invoice_auctions
      WHERE status = 'active' AND auction_end_time > NOW()
      ORDER BY auction_end_time ASC
      LIMIT $1
    `;
    const { rows } = await pool.query(query, [limit]);
    return rows;
  }

  static async findEndedAuctions(limit = 50) {
    const query = `
      SELECT *
      FROM invoice_auctions
      WHERE status = 'ended' OR status = 'settled'
      ORDER BY auction_end_time DESC
      LIMIT $1
    `;
    const { rows } = await pool.query(query, [limit]);
    return rows;
  }

  /*//////////////////////////////////////////////////////////////
                          BID READ QUERIES
  //////////////////////////////////////////////////////////////*/
  static async findBidsByAuction(auctionId) {
    const query = `
      SELECT *
      FROM auction_bids
      WHERE auction_id = $1
      ORDER BY yield_bps ASC, timestamp ASC
    `;
    const { rows } = await pool.query(query, [auctionId]);
    return rows;
  }

  static async findBidsByBidder(bidderAddress) {
    const query = `
      SELECT ab.*, ia.face_value, ia.min_yield_bps as auction_min_yield
      FROM auction_bids ab
      JOIN invoice_auctions ia ON ab.auction_id = ia.auction_id
      WHERE ab.bidder_address = $1
      ORDER BY ab.timestamp DESC
    `;
    const { rows } = await pool.query(query, [bidderAddress]);
    return rows;
  }

  static async findWinningBid(auctionId) {
    const query = `
      SELECT *
      FROM auction_bids
      WHERE auction_id = $1 AND status = 'winner'
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [auctionId]);
    return rows[0];
  }

  static async getBestBid(auctionId) {
    const query = `
      SELECT *
      FROM auction_bids
      WHERE auction_id = $1
      ORDER BY yield_bps ASC, timestamp ASC
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [auctionId]);
    return rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                          ANALYTICS
  //////////////////////////////////////////////////////////////*/
  static async getAuctionStats() {
    const query = `
      SELECT 
        COUNT(*) as total_auctions,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_auctions,
        COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_auctions,
        SUM(CASE WHEN status = 'settled' THEN face_value::numeric ELSE 0 END) as total_volume
      FROM invoice_auctions
    `;
    const { rows } = await pool.query(query);
    return rows[0];
  }

  static async getSellerStats(sellerAddress) {
    const query = `
      SELECT 
        COUNT(*) as total_auctions,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_auctions,
        COUNT(CASE WHEN status = 'settled' THEN 1 END) as settled_auctions,
        SUM(CASE WHEN status = 'settled' THEN face_value::numeric ELSE 0 END) as total_volume
      FROM invoice_auctions
      WHERE seller_address = $1
    `;
    const { rows } = await pool.query(query, [sellerAddress]);
    return rows[0];
  }

  static async getBidderStats(bidderAddress) {
    const query = `
      SELECT 
        COUNT(DISTINCT ab.auction_id) as total_bids,
        COUNT(CASE WHEN ab.status = 'winner' THEN 1 END) as winning_bids,
        SUM(CASE WHEN ab.status = 'winner' THEN ab.bid_amount::numeric ELSE 0 END) as total_won
      FROM auction_bids ab
      WHERE ab.bidder_address = $1
    `;
    const { rows } = await pool.query(query, [bidderAddress]);
    return rows[0];
  }
}

module.exports = InvoiceAuction;
