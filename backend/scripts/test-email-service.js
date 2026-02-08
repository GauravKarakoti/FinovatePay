require('dotenv').config();
const EmailService = require('../services/emailService');

async function testEmailService() {
  try {
    console.log('🧪 Testing Email Service...\n');

    // Get test email from environment variable
    const testEmail = process.env.TEST_EMAIL || 'your-email@example.com';
    console.log(`📧 Using email: ${testEmail}\n`);

    // Test 1: Send test email from template
    console.log('Test 1: Sending test email from template...');
    const result = await EmailService.sendFromTemplate(
      testEmail,
      'invoice-created',
      {
        userName: 'Test User',
        companyName: 'FinovatePay',
        invoiceId: 'INV-001',
        amount: '1000',
        currency: 'USD',
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
        buyerName: 'John Doe',
        dashboardUrl: 'http://localhost:5173/dashboard'
      }
    );

    console.log('✅ Email sent successfully!');
    console.log('Message ID:', result.messageId);
    console.log('Provider:', result.provider);

    // Test 2: Get email statistics
    console.log('\n\nTest 2: Getting email statistics...');
    const stats = await EmailService.getEmailStats();
    console.log('Email Statistics:');
    stats.forEach(stat => {
      console.log(`  - ${stat.status}: ${stat.count} (${stat.percentage}%)`);
    });

    console.log('\n✅ All tests completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testEmailService();
