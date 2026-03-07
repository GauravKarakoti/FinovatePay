/**
 * Whitelabel Controller
 * 
 * Handles white-label configuration management for multi-tenant deployments
 */

const Whitelabel = require('../models/Whitelabel');
const errorResponse = require('../utils/errorResponse');
const { authenticateToken, requireRole } = require('../middleware/auth');

/**
 * @route   POST /api/whitelabel/organizations
 * @desc    Create a new organization (Admin only)
 * @access  Private (Admin)
 */
exports.createOrganization = async (req, res) => {
  try {
    const {
      name,
      slug,
      domain,
      plan,
      maxUsers,
      maxInvoices,
      contactEmail,
      contactPhone,
      settings,
    } = req.body;

    // Validate required fields
    if (!name || !slug) {
      return res.status(400).json({
        error: 'Name and slug are required',
      });
    }

    // Validate slug format
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(slug)) {
      return res.status(400).json({
        error: 'Slug must contain only lowercase letters, numbers, and hyphens',
      });
    }

    // Check if slug already exists
    const existing = await Whitelabel.getOrganizationBySlug(slug);
    if (existing) {
      return res.status(409).json({
        error: 'Organization with this slug already exists',
      });
    }

    const organization = await Whitelabel.createOrganization({
      name,
      slug,
      domain,
      plan,
      maxUsers,
      maxInvoices,
      contactEmail,
      contactPhone,
      settings,
    });

    // Create default configuration
    await Whitelabel.createConfiguration(organization.id, {
      brandName: name,
      ...Whitelabel.getDefaultConfig(),
    });

    res.status(201).json({
      message: 'Organization created successfully',
      organization,
    });
  } catch (error) {
    console.error('[WhitelabelController] Create organization error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   GET /api/whitelabel/organizations
 * @desc    List all organizations (Admin only)
 * @access  Private (Admin)
 */
exports.listOrganizations = async (req, res) => {
  try {
    const { page, limit, status, plan } = req.query;

    const result = await Whitelabel.getAllOrganizations({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      status,
      plan,
    });

    res.json(result);
  } catch (error) {
    console.error('[WhitelabelController] List organizations error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   GET /api/whitelabel/organizations/:id
 * @desc    Get organization by ID
 * @access  Private
 */
exports.getOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const organization = await Whitelabel.getOrganizationById(id);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Check access: admins can see any org, others only their own
    if (req.user.role !== 'admin' && req.user.organization_id !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ organization });
  } catch (error) {
    console.error('[WhitelabelController] Get organization error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   PUT /api/whitelabel/organizations/:id
 * @desc    Update organization
 * @access  Private (Admin or Organization Admin)
 */
exports.updateOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    // Check access
    if (req.user.role !== 'admin' && req.user.organization_id !== id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const organization = await Whitelabel.updateOrganization(id, req.body);

    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({
      message: 'Organization updated successfully',
      organization,
    });
  } catch (error) {
    console.error('[WhitelabelController] Update organization error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   DELETE /api/whitelabel/organizations/:id
 * @desc    Delete organization (Admin only)
 * @access  Private (Admin)
 */
exports.deleteOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Whitelabel.deleteOrganization(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ message: 'Organization deleted successfully' });
  } catch (error) {
    console.error('[WhitelabelController] Delete organization error:', error);
    return errorResponse(res, error, 500);
  }
};

// ========================================
// Configuration Endpoints
// ========================================

/**
 * @route   GET /api/whitelabel/config
 * @desc    Get current organization's whitelabel configuration
 * @access  Private
 */
exports.getConfiguration = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      // Return default config for users without organization
      return res.json({
        configuration: Whitelabel.getDefaultConfig(),
        isDefault: true,
      });
    }

    const configuration = await Whitelabel.getConfiguration(organizationId);

    if (!configuration) {
      return res.json({
        configuration: Whitelabel.getDefaultConfig(),
        isDefault: true,
      });
    }

    res.json({
      configuration,
      isDefault: false,
    });
  } catch (error) {
    console.error('[WhitelabelController] Get configuration error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   GET /api/whitelabel/config/domain/:domain
 * @desc    Get whitelabel configuration by domain (Public)
 * @access  Public
 */
exports.getConfigurationByDomain = async (req, res) => {
  try {
    const { domain } = req.params;

    const config = await Whitelabel.getConfigurationByDomain(domain);

    if (!config) {
      return res.json({
        configuration: Whitelabel.getDefaultConfig(),
        isDefault: true,
      });
    }

    // Remove sensitive information
    const publicConfig = {
      organizationId: config.organization_id,
      organizationName: config.organization_name,
      brandName: config.brand_name,
      logoUrl: config.logo_url,
      logoDarkUrl: config.logo_dark_url,
      faviconUrl: config.favicon_url,
      primaryColor: config.primary_color,
      secondaryColor: config.secondary_color,
      accentColor: config.accent_color,
      backgroundColor: config.background_color,
      textColor: config.text_color,
      fontFamily: config.font_family,
      headingFont: config.heading_font,
      borderRadius: config.border_radius,
      buttonStyle: config.button_style,
      cardStyle: config.card_style,
      sidebarStyle: config.sidebar_style,
      headerStyle: config.header_style,
      footerEnabled: config.footer_enabled,
      customCss: config.custom_css,
      showPoweredBy: config.show_powered_by,
      footerLinks: config.footer_links,
      socialLinks: config.social_links,
      features: config.features,
      metaTitle: config.meta_title,
      metaDescription: config.meta_description,
      ogImageUrl: config.og_image_url,
    };

    res.json({
      configuration: publicConfig,
      isDefault: false,
    });
  } catch (error) {
    console.error('[WhitelabelController] Get config by domain error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   PUT /api/whitelabel/config
 * @desc    Update whitelabel configuration
 * @access  Private (Admin or Organization Admin)
 */
exports.updateConfiguration = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User is not associated with an organization',
      });
    }

    // Validate colors (hex format)
    const colorFields = ['primaryColor', 'secondaryColor', 'accentColor', 'backgroundColor', 'textColor'];
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;

    for (const field of colorFields) {
      if (req.body[field] && !hexRegex.test(req.body[field])) {
        return res.status(400).json({
          error: `${field} must be a valid hex color (e.g., #3B82F6)`,
        });
      }
    }

    const configuration = await Whitelabel.updateConfiguration(organizationId, req.body);

    if (!configuration) {
      return res.status(404).json({
        error: 'Configuration not found',
      });
    }

    res.json({
      message: 'Configuration updated successfully',
      configuration,
    });
  } catch (error) {
    console.error('[WhitelabelController] Update configuration error:', error);
    return errorResponse(res, error, 500);
  }
};

// ========================================
// Domain Verification Endpoints
// ========================================

/**
 * @route   POST /api/whitelabel/domains
 * @desc    Add a custom domain for verification
 * @access  Private (Admin or Organization Admin)
 */
exports.addCustomDomain = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;
    const { domain } = req.body;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User is not associated with an organization',
      });
    }

    if (!domain) {
      return res.status(400).json({
        error: 'Domain is required',
      });
    }

    // Validate domain format
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9](\.[a-zA-Z]{2,})+$/;
    if (!domainRegex.test(domain)) {
      return res.status(400).json({
        error: 'Invalid domain format',
      });
    }

    const verification = await Whitelabel.addCustomDomain(organizationId, domain);

    res.status(201).json({
      message: 'Domain added. Please verify ownership.',
      domain: domain,
      verificationToken: verification.verification_token,
      verificationMethod: verification.verification_method,
      instructions: {
        dns: `Add a TXT record with name: _whitelabel-verify and value: ${verification.verification_token}`,
        file: `Create a file at http://${domain}/.well-known/whitelabel-verification.txt with content: ${verification.verification_token}`,
      },
    });
  } catch (error) {
    console.error('[WhitelabelController] Add domain error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   POST /api/whitelabel/domains/:domain/verify
 * @desc    Verify a custom domain
 * @access  Private (Admin or Organization Admin)
 */
exports.verifyDomain = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;
    const { domain } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User is not associated with an organization',
      });
    }

    // Get verification details
    const verification = await Whitelabel.getDomainVerification(organizationId, domain);

    if (!verification) {
      return res.status(404).json({
        error: 'Domain verification request not found',
      });
    }

    if (verification.status === 'verified') {
      return res.json({
        message: 'Domain is already verified',
        domain,
        status: 'verified',
      });
    }

    // In production, you would actually verify the domain here
    // by checking DNS records or the verification file
    // For now, we'll mark it as verified
    const result = await Whitelabel.verifyDomain(organizationId, domain);

    res.json({
      message: 'Domain verified successfully',
      domain,
      status: 'verified',
    });
  } catch (error) {
    console.error('[WhitelabelController] Verify domain error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   DELETE /api/whitelabel/domains/:domain
 * @desc    Remove a custom domain
 * @access  Private (Admin or Organization Admin)
 */
exports.removeCustomDomain = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;
    const { domain } = req.params;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User is not associated with an organization',
      });
    }

    await Whitelabel.removeCustomDomain(organizationId, domain);

    res.json({
      message: 'Domain removed successfully',
      domain,
    });
  } catch (error) {
    console.error('[WhitelabelController] Remove domain error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   GET /api/whitelabel/domains
 * @desc    List all domains for organization
 * @access  Private
 */
exports.listDomains = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({
        error: 'User is not associated with an organization',
      });
    }

    const organization = await Whitelabel.getOrganizationById(organizationId);

    if (!organization) {
      return res.status(404).json({
        error: 'Organization not found',
      });
    }

    res.json({
      primaryDomain: organization.domain,
      customDomains: organization.custom_domains || [],
    });
  } catch (error) {
    console.error('[WhitelabelController] List domains error:', error);
    return errorResponse(res, error, 500);
  }
};

/**
 * @route   GET /api/whitelabel/limits
 * @desc    Check organization limits
 * @access  Private
 */
exports.checkLimits = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.json({
        limits: null,
        message: 'User is not associated with an organization',
      });
    }

    const usersLimit = await Whitelabel.checkLimits(organizationId, 'users');
    const invoicesLimit = await Whitelabel.checkLimits(organizationId, 'invoices');

    const organization = await Whitelabel.getOrganizationById(organizationId);

    res.json({
      limits: {
        users: {
          max: organization.max_users,
          withinLimit: usersLimit.withinLimit,
        },
        invoices: {
          max: organization.max_invoices,
          withinLimit: invoicesLimit.withinLimit,
        },
        plan: organization.plan,
      },
    });
  } catch (error) {
    console.error('[WhitelabelController] Check limits error:', error);
    return errorResponse(res, error, 500);
  }
};
