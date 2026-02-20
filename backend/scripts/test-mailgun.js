require('dotenv').config();
const Mailgun = require('mailgun.js');
const FormData = require('form-data');

async function testMailgun() {
  console.log('🔍 Testing Mailgun Credentials...\n');
  
  console.log('Configuration:');
  console.log(`  API Key: ${process.env.MAILGUN_API_KEY.substring(0, 10)}...`);
  console.log(`  Domain: ${process.env.MAILGUN_DOMAIN}`);
  console.log(`  Sender: ${process.env.MAILGUN_SENDER_EMAIL}\n`);

  try {
    const mailgun = new Mailgun(FormData);
    const client = mailgun.client({
      username: 'api',
      key: process.env.MAILGUN_API_KEY
    });

    // Try to get domain info (lightweight test)
    const domain = await client.domains.get(process.env.MAILGUN_DOMAIN);
    
    console.log('✅ Mailgun credentials are VALID!\n');
    console.log(`Domain: ${domain.name}`);
    console.log(`Status: ${domain.state}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Mailgun credentials are INVALID!\n');
    console.error(`Error: ${error.message}`);
    console.error('\nPossible issues:');
    console.error('  1. API Key is incorrect');
    console.error('  2. Domain is incorrect');
    console.error('  3. API Key has wrong format');
    console.error('  4. Extra spaces in .env file');
    
    process.exit(1);
  }
}

testMailgun();