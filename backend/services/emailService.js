const MailerSend = require('mailersend');
const { EmailParams } = MailerSend;
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const handlebars = require('handlebars');

// Initialize MailerSend client
const mailerSend = new MailerSend({
  api_key: process.env.MAILERSEND_API_KEY
});

class EmailService {
  /**
   * Send email via MailerSend
   * @param {string} recipientEmail - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} htmlContent - HTML content
   * @param {object} metadata - Additional metadata
   * @returns {object} - Result object with success status and message ID
   */
  static async sendEmail(recipientEmail, subject, htmlContent, metadata = {}) {
    try {
      const emailId = uuidv4();

      // Log email attempt
      await this.logEmail({
        id: emailId,
        recipientEmail,
        subject,
        status: 'pending',
        metadata
      });

      // Create email parameters for MailerSend
      const emailParams = new EmailParams();
      emailParams.setFrom({
        email: process.env.MAILERSEND_SENDER_EMAIL,
        name: process.env.MAILERSEND_SENDER_NAME
      });
      emailParams.setRecipients([
        {
          email: recipientEmail
        }
      ]);
      emailParams.setSubject(subject);
      emailParams.setHtml(htmlContent);

      // Send email via MailerSend
      const result = await mailerSend.send(emailParams);

      // Update log status to sent
      await this.updateEmailLog(emailId, 'sent', { message_id: result?.message_id || emailId });

      console.log(`✅ [Email Service] Email sent successfully. ID: ${result?.message_id || emailId}`);
      return {
        success: true,
        messageId: result?.message_id || emailId,
        emailId: emailId,
        provider: 'MailerSend'
      };
    } catch (error) {
      console.error('❌ [Email Service] Error sending email:', error.message);

      // Log error
      await this.updateEmailLog(
        metadata.emailLogId || uuidv4(),
        'failed',
        null,
        error.message
      );

      throw error;
    }
  }

  /**
   * Send email from template with variable interpolation
   * @param {string} recipientEmail - Recipient email
   * @param {string} templateName - Template name (e.g., 'invoice-created')
   * @param {object} variables - Template variables to interpolate
   * @param {integer} userId - User ID (optional)
   * @returns {object} - Result
   */
  static async sendFromTemplate(recipientEmail, templateName, variables = {}, userId = null) {
    try {
      // Fetch template from database
      const template = await this.getEmailTemplate(templateName);

      if (!template) {
        throw new Error(`Email template not found: ${templateName}`);
      }

      // Compile Handlebars templates
      const subjectTemplate = handlebars.compile(template.subject);
      const htmlTemplate = handlebars.compile(template.html_content);

      // Render with variables
      const subject = subjectTemplate(variables);
      const htmlContent = htmlTemplate(variables);

      // Send email
      const result = await this.sendEmail(
        recipientEmail,
        subject,
        htmlContent,
        {
          event_type: templateName,
          user_id: userId,
          template_name: templateName
        }
      );

      return result;
    } catch (error) {
      console.error(
        `❌ [Email Service] Error sending template email (${templateName}):`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Log email to database
   * @param {object} emailData - Email data object
   */
  static async logEmail(emailData) {
    try {
      const query = `
        INSERT INTO email_logs (
          id, user_id, recipient_email, subject, template_name,
          event_type, status, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;

      await pool.query(query, [
        emailData.id || uuidv4(),
        emailData.user_id || null,
        emailData.recipientEmail,
        emailData.subject || null,
        emailData.template_name || null,
        emailData.metadata?.event_type || 'transaction',
        emailData.status || 'pending',
        JSON.stringify(emailData.metadata || {})
      ]);

      console.log(`📝 [Email Service] Email logged: ${emailData.id}`);
    } catch (error) {
      console.error('❌ [Email Service] Error logging email:', error.message);
    }
  }

  /**
   * Update email log status
   * @param {string} emailId - Email ID
   * @param {string} status - New status (sent/failed/pending/bounced)
   * @param {object} result - Result object from provider
   * @param {string} errorMessage - Error message if failed
   */
  static async updateEmailLog(emailId, status, result = null, errorMessage = null) {
    try {
      let query = `UPDATE email_logs SET status = $1, updated_at = NOW()`;
      const params = [status, emailId];

      if (status === 'sent') {
        query += ` , sent_at = NOW()`;
      }

      if (errorMessage) {
        query += ` , error_message = $${params.length + 1}`;
        params.push(errorMessage);
      }

      query += ` WHERE id = $2`;

      await pool.query(query, params);

      console.log(`📊 [Email Service] Email log updated: ${emailId} → ${status}`);
    } catch (error) {
      console.error('❌ [Email Service] Error updating email log:', error.message);
    }
  }

  /**
   * Get email template from database
   * @param {string} templateName - Template name
   * @returns {object} - Template object or null
   */
  static async getEmailTemplate(templateName) {
    try {
      const query = `
        SELECT id, name, subject, html_content, variables
        FROM email_templates
        WHERE name = $1 AND is_active = true
      `;

      const result = await pool.query(query, [templateName]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ [Email Service] Error fetching template:', error.message);
      return null;
    }
  }

  /**
   * Get email sending history for user
   * @param {integer} userId - User ID
   * @param {integer} limit - Number of records to return
   * @param {integer} offset - Offset for pagination
   * @returns {array} - Array of email logs
   */
  static async getEmailHistory(userId, limit = 50, offset = 0) {
    try {
      const query = `
        SELECT id, recipient_email, template_name, event_type, status,
               sent_at, created_at
        FROM email_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await pool.query(query, [userId, limit, offset]);
      return result.rows;
    } catch (error) {
      console.error('❌ [Email Service] Error fetching email history:', error.message);
      return [];
    }
  }

  /**
   * Get email statistics
   * @returns {object} - Email statistics
   */
  static async getEmailStats() {
    try {
      const query = `
        SELECT
          status,
          COUNT(*) as count,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM email_logs), 2) as percentage
        FROM email_logs
        GROUP BY status
      `;

      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('❌ [Email Service] Error getting email stats:', error.message);
      return [];
    }
  }

  /**
   * Retry failed emails
   * @returns {object} - Retry result
   */
  static async retryFailedEmails() {
    try {
      const query = `
        SELECT id, recipient_email, subject, template_name, metadata
        FROM email_logs
        WHERE status = 'failed' AND retry_count < max_retries
        AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 100
      `;

      const result = await pool.query(query);
      const failedEmails = result.rows;

      console.log(`🔄 [Email Service] Retrying ${failedEmails.length} failed emails...`);

      let successful = 0;
      let failed = 0;

      for (const email of failedEmails) {
        try {
          await this.sendEmail(
            email.recipient_email,
            email.subject,
            email.metadata?.htmlContent || '',
            email.metadata
          );

          // Increment retry count
          await pool.query(
            'UPDATE email_logs SET retry_count = retry_count + 1 WHERE id = $1',
            [email.id]
          );

          successful++;
        } catch (error) {
          console.error(
            `❌ [Email Service] Failed to retry email ${email.id}:`,
            error.message
          );
          failed++;
        }
      }

      return { successful, failed, total: failedEmails.length };
    } catch (error) {
      console.error('❌ [Email Service] Error in retry logic:', error.message);
      return { successful: 0, failed: 0, total: 0 };
    }
  }
}

module.exports = EmailService;
