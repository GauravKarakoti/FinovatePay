const { Pool } = require('pg');

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    // Add this SSL configuration for services like Heroku, Render, etc.
    ssl: {
      rejectUnauthorized: false
    }
});

// const initializeDbQuery = `
//   -- Add a column to track the available quantity, separate from the initial quantity
//   ALTER TABLE produce_lots ADD COLUMN current_quantity DECIMAL(18, 2);

//   -- Add a column for the seller to set the price per kg
//   ALTER TABLE produce_lots ADD COLUMN price DECIMAL(18, 2) NOT NULL DEFAULT 0.00;

//   -- Initialize the new column with the initial quantity for existing lots
//   UPDATE produce_lots SET current_quantity = quantity WHERE current_quantity IS NULL;

//   -- Add a column to the invoices table to link it to a specific produce lot
//   ALTER TABLE invoices ADD COLUMN lot_id INTEGER REFERENCES produce_lots(lot_id);
// `;

// const initializeDatabase = async () => {
//   const client = await pool.connect();
//   try {
//     await client.query(initializeDbQuery);
//     console.log('✅ Database schema checked and initialized successfully.');
//   } catch (err) {
//     console.error('❌ Error initializing database schema:', err.stack);
//     process.exit(1); 
//   } finally {
//     client.release();
//   }
// };

// initializeDatabase();

module.exports = pool;