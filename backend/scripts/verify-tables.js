require('dotenv').config();
const { Pool } = require('pg');

async function verifyTables() {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('\n📊 CHECKING DATABASE TABLES...\n');

    // Get all tables
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    if (tablesResult.rows.length === 0) {
      console.log('❌ No tables found in database!');
      await pool.end();
      process.exit(1);
    }

    console.log(`✅ Found ${tablesResult.rows.length} tables:\n`);
    
    for (const { table_name } of tablesResult.rows) {
      console.log(`   📋 ${table_name}`);

      // Get column info for each table
      const columnsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `, [table_name]);

      columnsResult.rows.forEach(col => {
        const nullable = col.is_nullable === 'YES' ? '(nullable)' : '(required)';
        console.log(`      ├─ ${col.column_name}: ${col.data_type} ${nullable}`);
      });

      // Get row count - use identifier quoting to prevent SQL injection
      // Validate table name against whitelist from information_schema
      // This ensures table_name is a legitimate table in the database
      const sanitizedTableName = table_name.replace(/[^a-zA-Z0-9_]/g, '');
      if (sanitizedTableName !== table_name) {
        console.log(`      └─ ⚠️  Skipped (invalid table name)\n`);
        continue;
      }
      
      // Use pg-format or manual identifier quoting for safety
      const countResult = await pool.query(
        `SELECT COUNT(*) FROM "${table_name}"`
      );
      const rowCount = countResult.rows[0].count;
      console.log(`      └─ Rows: ${rowCount}\n`);
    }

    // Check specifically for our email tables
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📧 EMAIL SYSTEM TABLES STATUS:\n');

    const emailTables = ['email_logs', 'user_notification_preferences', 'email_templates'];
    
    for (const tableName of emailTables) {
      const exists = tablesResult.rows.some(row => row.table_name === tableName);
      if (exists) {
        console.log(`   ✅ ${tableName} - CREATED`);
      } else {
        console.log(`   ❌ ${tableName} - MISSING`);
      }
    }

    console.log('\n✅ Database verification complete!\n');
    
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error verifying tables:', error.message);
    await pool.end();
    process.exit(1);
  }
}

verifyTables();
