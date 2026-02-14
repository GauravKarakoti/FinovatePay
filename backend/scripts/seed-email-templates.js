require('dotenv').config();
const { pool } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const templates = [
  {
    name: 'invoice-created',
    subject: 'Invoice Created: {{invoiceId}}',
    filePath: '../templates/invoice-created.hbs'
  },
  {
    name: 'payment-confirmed',
    subject: 'Payment Confirmed: {{amount}} {{currency}}',
    filePath: '../templates/payment-confirmed.hbs'
  },
  {
    name: 'dispute-raised',
    subject: 'Dispute Raised for Invoice {{invoiceId}}',
    filePath: '../templates/dispute-raised.hbs'
  },
  {
    name: 'shipment-confirmed',
    subject: 'Your Shipment is On Its Way',
    filePath: '../templates/shipment-confirmed.hbs'
  },
  {
    name: 'kyc-status-update',
    subject: 'Your KYC Status Has Been Updated',
    filePath: '../templates/kyc-status-update.hbs'
  }
];

async function seedTemplates() {
  try {
    console.log('📧 Seeding email templates...\n');

    for (const template of templates) {
      try {
        // Read template file
        const filePath = path.join(__dirname, template.filePath);
        const htmlContent = fs.readFileSync(filePath, 'utf-8');

        // Check if template already exists
        const checkQuery = 'SELECT id FROM email_templates WHERE name = $1';
        const existingTemplate = await pool.query(checkQuery, [template.name]);

        if (existingTemplate.rows.length > 0) {
          // Update existing template
          const updateQuery = `
            UPDATE email_templates
            SET html_content = $1, subject = $2, updated_at = NOW(), version = version + 1
            WHERE name = $3
          `;
          await pool.query(updateQuery, [htmlContent, template.subject, template.name]);
          console.log(`✅ Updated template: ${template.name}`);
        } else {
          // Insert new template
          const insertQuery = `
            INSERT INTO email_templates (id, name, subject, html_content, is_active, version)
            VALUES ($1, $2, $3, $4, true, 1)
          `;
          await pool.query(insertQuery, [
            uuidv4(),
            template.name,
            template.subject,
            htmlContent
          ]);
          console.log(`✅ Created template: ${template.name}`);
        }
      } catch (templateError) {
        console.error(`❌ Error processing template ${template.name}:`, templateError.message);
      }
    }

    console.log('\n✅ Email templates seeded successfully!');
    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding templates:', error.message);
    await pool.end();
    process.exit(1);
  }
}

// Run seeding
seedTemplates();

