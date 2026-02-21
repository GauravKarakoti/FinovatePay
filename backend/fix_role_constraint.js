// Fix for Issue #196: Update database role constraint
// Run this with: node fix_role_constraint.js

const { pool } = require('./config/database');

async function fixRoleConstraint() {
  try {
    console.log('🔧 Fixing database role constraint for Issue #196...\n');

    // Drop old constraint
    console.log('1. Dropping old constraint...');
    await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
    console.log('   ✅ Old constraint dropped\n');

    // Add new constraint with all 4 roles
    console.log('2. Adding new constraint with investor and shipment roles...');
    await pool.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check 
      CHECK (role IN ('buyer', 'seller', 'investor', 'shipment'))
    `);
    console.log('   ✅ New constraint added\n');

    // Verify the constraint
    console.log('3. Verifying new constraint...');
    const result = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint 
      WHERE conname = 'users_role_check'
    `);
    
    if (result.rows.length > 0) {
      console.log('   ✅ Constraint verified:');
      console.log('   Name:', result.rows[0].conname);
      console.log('   Definition:', result.rows[0].definition);
    }

    console.log('\n🎉 Database constraint fixed successfully!');
    console.log('✅ Users can now register with: buyer, seller, investor, shipment\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error fixing constraint:', error.message);
    process.exit(1);
  }
}

fixRoleConstraint();
