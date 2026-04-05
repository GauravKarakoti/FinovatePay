/**
 * Whitelabel Model
 * 
 * Manages white-label configurations for multi-tenant deployments
 */

const { pool } = require('../config/database');

class Whitelabel {
  /**
   * Create a new organization
   * @param {Object} data - Organization data
   * @returns {Promise<Object>} Created organization
   */
  static async createOrganization(data) {
    const {
      name,
      slug,
      domain,
      plan = 'starter',
      maxUsers = 10,
      maxInvoices = 100,
      contactEmail,
      contactPhone,
      settings = {},
    } = data;

    const query = `
      INSERT INTO organizations (
        name, slug, domain, plan, max_users, max_invoices, contact_email, contact_phone, settings
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
      name, slug, domain, plan, maxUsers, maxInvoices, contactEmail, contactPhone, settings
    ]);

    return result.rows[0];
  }

  /**
   * Get organization by ID
   * @param {string} id - Organization ID
   * @returns {Promise<Object|null>}
   */
  static async getOrganizationById(id) {
    const query = 'SELECT * FROM organizations WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Get organization by slug
   * @param {string} slug - Organization slug
   * @returns {Promise<Object|null>}
   */
  static async getOrganizationBySlug(slug) {
    const query = 'SELECT * FROM organizations WHERE slug = $1';
    const result = await pool.query(query, [slug]);
    return result.rows[0] || null;
  }

  /**
   * Get organization by domain
   * @param {string} domain - Domain name
   * @returns {Promise<Object|null>}
   */
  static async getOrganizationByDomain(domain) {
    const query = `
      SELECT * FROM organizations 
      WHERE (domain = $1 OR $1 = ANY(custom_domains)) AND status = 'active'
    `;
    const result = await pool.query(query, [domain]);
    return result.rows[0] || null;
  }

  /**
   * Update organization
   * @param {string} id - Organization ID
   * @param {Object} data - Update data
   * @returns {Promise<Object|null>}
   */
  static async updateOrganization(id, data) {
    const allowedFields = [
      'name', 'domain', 'custom_domains', 'status', 'plan',
      'max_users', 'max_invoices', 'contact_email', 'contact_phone', 'settings'
    ];

    const updates = [];
    const values = [id];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(data)) {
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbField)) {
        updates.push(`${dbField} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) return null;

    const query = `
      UPDATE organizations 
      SET ${updates.join(', ')} 
      WHERE id = $1 
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Get all organizations with pagination
   * @param {Object} options - Pagination and filter options
   * @returns {Promise<Object>}
   */
  static async getAllOrganizations({ page = 1, limit = 20, status, plan }) {
    let query = 'SELECT * FROM organizations WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      params.push(status);
    }

    if (plan) {
      query += ` AND plan = $${paramIndex++}`;
      params.push(plan);
    }

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM (${query}) as subq`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Add pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, (page - 1) * limit);

    const result = await pool.query(query, params);

    return {
      organizations: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create whitelabel configuration for an organization
   * @param {string} organizationId - Organization ID
   * @param {Object} config - Configuration data
   * @returns {Promise<Object>}
   */
  static async createConfiguration(organizationId, config) {
    const query = `
      INSERT INTO whitelabel_configurations (
        organization_id, brand_name, tagline, logo_url, logo_dark_url, favicon_url,
        primary_color, secondary_color, accent_color, background_color, text_color,
        font_family, heading_font, border_radius, button_style, card_style,
        sidebar_style, header_style, footer_enabled, custom_css, custom_js,
        show_powered_by, footer_links, social_links, email_sender_name, email_sender_address,
        email_template_header, email_template_footer, features, meta_title, meta_description, og_image_url
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
      RETURNING *
    `;

    const values = [
      organizationId,
      config.brandName,
      config.tagline,
      config.logoUrl,
      config.logoDarkUrl,
      config.faviconUrl,
      config.primaryColor || '#3B82F6',
      config.secondaryColor || '#1E40AF',
      config.accentColor || '#10B981',
      config.backgroundColor || '#FFFFFF',
      config.textColor || '#1F2937',
      config.fontFamily || 'Inter',
      config.headingFont || 'Inter',
      config.borderRadius || '8px',
      config.buttonStyle || 'rounded',
      config.cardStyle || 'shadow',
      config.sidebarStyle || 'fixed',
      config.headerStyle || 'standard',
      config.footerEnabled !== false,
      config.customCss,
      config.customJs,
      config.showPoweredBy !== false,
      config.footerLinks || [],
      config.socialLinks || {},
      config.emailSenderName,
      config.emailSenderAddress,
      config.emailTemplateHeader,
      config.emailTemplateFooter,
      config.features || {},
      config.metaTitle,
      config.metaDescription,
      config.ogImageUrl,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Get whitelabel configuration for an organization
   * @param {string} organizationId - Organization ID
   * @returns {Promise<Object|null>}
   */
  static async getConfiguration(organizationId) {
    const query = 'SELECT * FROM whitelabel_configurations WHERE organization_id = $1';
    const result = await pool.query(query, [organizationId]);
    return result.rows[0] || null;
  }

  static async getConfigurationByDomain(domain) {
    const query = `
      SELECT 
        o.id as organization_id, o.name as organization_name,
        o.plan, o.status as organization_status,
        w.*
      FROM organizations o
      LEFT JOIN whitelabel_configurations w ON o.id = w.organization_id
      WHERE (o.domain = $1 OR $1 = ANY(o.custom_domains)) AND o.status = 'active'
    `;
    const result = await pool.query(query, [domain]);
    return result.rows[0] || null;
  }

  /**
   * Update whitelabel configuration
   * @param {string} organizationId - Organization ID
   * @param {Object} config - Configuration updates
   * @returns {Promise<Object|null>}
   */
  static async updateConfiguration(organizationId, config) {
    const allowedFields = [
      'brand_name', 'tagline', 'logo_url', 'logo_dark_url', 'favicon_url',
      'primary_color', 'secondary_color', 'accent_color', 'background_color', 'text_color',
      'font_family', 'heading_font', 'border_radius', 'button_style', 'card_style',
      'sidebar_style', 'header_style', 'footer_enabled', 'custom_css', 'custom_js',
      'show_powered_by', 'footer_links', 'social_links', 'email_sender_name', 'email_sender_address',
      'email_template_header', 'email_template_footer', 'features', 'meta_title', 'meta_description', 'og_image_url'
    ];

    const updates = [];
    const values = [organizationId];
    let paramIndex = 2;

    for (const [key, value] of Object.entries(config)) {
      const dbField = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowedFields.includes(dbField)) {
        updates.push(`${dbField} = $${paramIndex++}`);
        values.push(value);
      }
    }

    if (updates.length === 0) return null;

    const query = `
      UPDATE whitelabel_configurations 
      SET ${updates.join(', ')} 
      WHERE organization_id = $1 
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  /**
   * Delete organization and all related data
   * @param {string} id - Organization ID
   * @returns {Promise<boolean>}
   */
  static async deleteOrganization(id) {
    const query = 'DELETE FROM organizations WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [id]);
    return result.rowCount > 0;
  }

  // ========================================
  // Domain Verification Methods
  // ========================================

  /**
   * Add a custom domain for verification
   * @param {string} organizationId - Organization ID
   * @param {string} domain - Domain to verify
   * @returns {Promise<Object>}
   */
  static async addCustomDomain(organizationId, domain) {
    const crypto = require('crypto');
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const query = `
      INSERT INTO domain_verifications (organization_id, domain, verification_token, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING *
    `;

    const result = await pool.query(query, [organizationId, domain, verificationToken]);
    return result.rows[0];
  }

  /**
   * Verify a custom domain
   * @param {string} organizationId - Organization ID
   * @param {string} domain - Domain to verify
   * @returns {Promise<Object>}
   */
  static async verifyDomain(organizationId, domain) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Update domain verification
      const verifyQuery = `
        UPDATE domain_verifications 
        SET status = 'verified', verified_at = NOW()
        WHERE organization_id = $1 AND domain = $2
        RETURNING *
      `;
      const verifyResult = await client.query(verifyQuery, [organizationId, domain]);

      if (verifyResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      // Add domain to organization's custom_domains array
      const addDomainQuery = `
        UPDATE organizations 
        SET custom_domains = array_append(custom_domains, $2)
        WHERE id = $1
        RETURNING *
      `;
      await client.query(addDomainQuery, [organizationId, domain]);

      await client.query('COMMIT');
      return verifyResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get domain verification status
   * @param {string} organizationId - Organization ID
   * @param {string} domain - Domain name
   * @returns {Promise<Object|null>}
   */
  static async getDomainVerification(organizationId, domain) {
    const query = `
      SELECT * FROM domain_verifications 
      WHERE organization_id = $1 AND domain = $2
    `;
    const result = await pool.query(query, [organizationId, domain]);
    return result.rows[0] || null;
  }

  /**
   * Remove a custom domain
   * @param {string} organizationId - Organization ID
   * @param {string} domain - Domain to remove
   * @returns {Promise<boolean>}
   */
  static async removeCustomDomain(organizationId, domain) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Remove from domain_verifications
      await client.query(
        'DELETE FROM domain_verifications WHERE organization_id = $1 AND domain = $2',
        [organizationId, domain]
      );

      // Remove from organization's custom_domains array
      await client.query(
        'UPDATE organizations SET custom_domains = array_remove(custom_domains, $2) WHERE id = $1',
        [organizationId, domain]
      );

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Check organization limits
   * @param {string} organizationId - Organization ID
   * @param {string} limitType - 'users' or 'invoices'
   * @returns {Promise<Object>}
   */
  static async checkLimits(organizationId, limitType) {
    const query = 'SELECT * FROM check_organization_limit($1, $2)';
    const result = await pool.query(query, [organizationId, limitType]);
    return {
      withinLimit: result.rows[0]?.check_organization_limit || false,
    };
  }

  /**
   * Get default configuration
   * @returns {Object}
   */
  static getDefaultConfig() {
    return {
      brandName: 'FinovatePay',
      primaryColor: '#3B82F6',
      secondaryColor: '#1E40AF',
      accentColor: '#10B981',
      backgroundColor: '#FFFFFF',
      textColor: '#1F2937',
      fontFamily: 'Inter',
      headingFont: 'Inter',
      borderRadius: '8px',
      buttonStyle: 'rounded',
      cardStyle: 'shadow',
      sidebarStyle: 'fixed',
      headerStyle: 'standard',
      footerEnabled: true,
      showPoweredBy: true,
      footerLinks: [
        { label: 'Terms of Service', url: '/terms' },
        { label: 'Privacy Policy', url: '/privacy' },
        { label: 'Contact', url: '/contact' },
      ],
      socialLinks: {},
      features: {
        escrow: true,
        streaming: true,
        financing: true,
        marketplace: true,
      },
    };
  }
}

module.exports = Whitelabel;
