const { pool } = require('../config/database');

class Currency {
  /*//////////////////////////////////////////////////////////////
                    GET SUPPORTED CURRENCIES
  //////////////////////////////////////////////////////////////*/
  static async getAll(activeOnly = true) {
    let query = 'SELECT * FROM currencies';
    const values = [];

    if (activeOnly) {
      query += ' WHERE is_active = TRUE';
    }

    query += ' ORDER BY is_default DESC, code ASC';

    const { rows } = await pool.query(query, values);
    return rows;
  }

  static async getByCode(code) {
    const query = 'SELECT * FROM currencies WHERE code = $1';
    const { rows } = await pool.query(query, [code.toUpperCase()]);
    return rows[0];
  }

  static async getCryptoCurrencies() {
    const query = `
      SELECT * FROM currencies 
      WHERE is_crypto = TRUE AND is_active = TRUE 
      ORDER BY code ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  static async getFiatCurrencies() {
    const query = `
      SELECT * FROM currencies 
      WHERE is_crypto = FALSE AND is_active = TRUE 
      ORDER BY is_default DESC, code ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  /*//////////////////////////////////////////////////////////////
                    EXCHANGE RATES
  //////////////////////////////////////////////////////////////*/
  static async getExchangeRates() {
    const query = `
      SELECT er.currency_code, er.rate, er.updated_at, c.name, c.symbol, c.decimal_places
      FROM exchange_rates er
      JOIN currencies c ON c.code = er.currency_code
      ORDER BY c.is_default DESC, c.code ASC
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  static async getExchangeRate(currencyCode) {
    const query = `
      SELECT er.currency_code, er.rate, er.updated_at, c.name, c.symbol, c.decimal_places
      FROM exchange_rates er
      JOIN currencies c ON c.code = er.currency_code
      WHERE er.currency_code = $1
    `;
    const { rows } = await pool.query(query, [currencyCode.toUpperCase()]);
    return rows[0];
  }

  static async updateExchangeRate(currencyCode, rate) {
    const query = `
      UPDATE exchange_rates
      SET rate = $2, updated_at = NOW()
      WHERE currency_code = $1
      RETURNING *
    `;
    const { rows } = await pool.query(query, [currencyCode.toUpperCase(), rate]);
    return rows[0];
  }

  static async bulkUpdateExchangeRates(rates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const { currencyCode, rate } of rates) {
        await client.query(
          `INSERT INTO exchange_rates (currency_code, rate)
           VALUES ($1, $2)
           ON CONFLICT (currency_code) 
           DO UPDATE SET rate = $2, updated_at = NOW()`,
          [currencyCode.toUpperCase(), rate]
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /*//////////////////////////////////////////////////////////////
                    CONVERSION
  //////////////////////////////////////////////////////////////*/
  static async convert(amount, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) {
      return { amount, rate: 1 };
    }

    // Get rates relative to USD
    const fromRate = await this.getExchangeRate(fromCurrency);
    const toRate = await this.getExchangeRate(toCurrency);

    if (!fromRate || !toRate) {
      throw new Error('Currency not found');
    }

    // Convert: amount in fromCurrency -> USD -> toCurrency
    // rate = (amount / fromRate) * toRate
    const rate = toRate.rate / fromRate.rate;
    const convertedAmount = (amount / fromRate.rate) * toRate.rate;

    return {
      amount: convertedAmount,
      rate,
      fromCurrency,
      toCurrency
    };
  }

  /*//////////////////////////////////////////////////////////////
                    USER PREFERENCES
  //////////////////////////////////////////////////////////////*/
  static async getUserPreference(userId) {
    const query = `
      SELECT * FROM user_currency_preferences WHERE user_id = $1
    `;
    const { rows } = await pool.query(query, [userId]);
    return rows[0];
  }

  static async setUserPreference(userId, preferredCurrency, displayCurrency) {
    const query = `
      INSERT INTO user_currency_preferences (user_id, preferred_currency, display_currency)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) 
      DO UPDATE SET preferred_currency = $2, display_currency = $3, updated_at = NOW()
      RETURNING *
    `;
    const { rows } = await pool.query(query, [
      userId,
      preferredCurrency || 'USD',
      displayCurrency || 'USD'
    ]);
    return rows[0];
  }

  /*//////////////////////////////////////////////////////////////
                    DEFAULT CURRENCY
  //////////////////////////////////////////////////////////////*/
  static async getDefaultCurrency() {
    const query = 'SELECT * FROM currencies WHERE is_default = TRUE';
    const { rows } = await pool.query(query);
    return rows[0];
  }
}

module.exports = Currency;
