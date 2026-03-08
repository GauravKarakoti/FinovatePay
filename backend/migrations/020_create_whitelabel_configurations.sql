-- Migration: 009_create_whitelabel_configurations.sql
-- Creates tables for white-label/multi-tenant configuration
-- Enables partners to customize branding, themes, and domain settings

-- Create organizations table (main tenant entity)
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    domain VARCHAR(255) UNIQUE,
    custom_domains TEXT[] DEFAULT '{}',
    
    -- Status and limits
    status VARCHAR(50) DEFAULT 'active',
    plan VARCHAR(50) DEFAULT 'starter',
    max_users INTEGER DEFAULT 10,
    max_invoices INTEGER DEFAULT 100,
    
    -- Contact information
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    
    -- Settings
    settings JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_status CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    CONSTRAINT valid_plan CHECK (plan IN ('starter', 'professional', 'enterprise', 'white_label'))
);

-- Create whitelabel_configurations table
CREATE TABLE IF NOT EXISTS whitelabel_configurations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Branding
    brand_name VARCHAR(255) NOT NULL,
    tagline VARCHAR(500),
    logo_url VARCHAR(1000),
    logo_dark_url VARCHAR(1000),
    favicon_url VARCHAR(1000),
    
    -- Theme Colors
    primary_color VARCHAR(7) DEFAULT '#3B82F6',
    secondary_color VARCHAR(7) DEFAULT '#1E40AF',
    accent_color VARCHAR(7) DEFAULT '#10B981',
    background_color VARCHAR(7) DEFAULT '#FFFFFF',
    text_color VARCHAR(7) DEFAULT '#1F2937',
    
    -- Typography
    font_family VARCHAR(100) DEFAULT 'Inter',
    heading_font VARCHAR(100) DEFAULT 'Inter',
    
    -- UI Customization
    border_radius VARCHAR(20) DEFAULT '8px',
    button_style VARCHAR(50) DEFAULT 'rounded',
    card_style VARCHAR(50) DEFAULT 'shadow',
    
    -- Layout
    sidebar_style VARCHAR(50) DEFAULT 'fixed',
    header_style VARCHAR(50) DEFAULT 'standard',
    footer_enabled BOOLEAN DEFAULT true,
    
    -- Custom Content
    custom_css TEXT,
    custom_js TEXT,
    
    -- Logo and Footer
    show_powered_by BOOLEAN DEFAULT true,
    footer_links JSONB DEFAULT '[]',
    social_links JSONB DEFAULT '{}',
    
    -- Email Configuration
    email_sender_name VARCHAR(255),
    email_sender_address VARCHAR(255),
    email_template_header TEXT,
    email_template_footer TEXT,
    
    -- Feature Flags
    features JSONB DEFAULT '{}',
    
    -- Meta Information
    meta_title VARCHAR(255),
    meta_description TEXT,
    og_image_url VARCHAR(1000),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_organization_config UNIQUE (organization_id)
);

-- Create domain verifications table
CREATE TABLE IF NOT EXISTS domain_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    verification_token VARCHAR(255) NOT NULL,
    verification_method VARCHAR(50) DEFAULT 'dns',
    status VARCHAR(50) DEFAULT 'pending',
    verified_at TIMESTAMP WITH TIME ZONE,
    ssl_provisioned BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_domain UNIQUE (domain),
    CONSTRAINT valid_verification_method CHECK (verification_method IN ('dns', 'file'))
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organizations_domain ON organizations(domain);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_whitelabel_config_org ON whitelabel_configurations(organization_id);
CREATE INDEX IF NOT EXISTS idx_domain_verifications_org ON domain_verifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_domain_verifications_domain ON domain_verifications(domain);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_organizations_updated_at
    BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_whitelabel_config_updated_at
    BEFORE UPDATE ON whitelabel_configurations
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trigger_domain_verifications_updated_at
    BEFORE UPDATE ON domain_verifications
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Insert default organization for platform itself
INSERT INTO organizations (name, slug, domain, status, plan, max_users, max_invoices)
VALUES ('FinovatePay', 'finovatepay', 'finovatepay.com', 'active', 'enterprise', 10000, 1000000)
ON CONFLICT (slug) DO NOTHING;

-- Add comments for documentation
COMMENT ON TABLE organizations IS 'Multi-tenant organizations/partners';
COMMENT ON TABLE whitelabel_configurations IS 'White-label branding and theme configurations per organization';
COMMENT ON TABLE domain_verifications IS 'Custom domain verification tracking for organizations';

-- Create function to get whitelabel config by domain
CREATE OR REPLACE FUNCTION get_whitelabel_config_by_domain(domain_name VARCHAR)
RETURNS TABLE (
    organization_id UUID,
    org_name VARCHAR,
    org_slug VARCHAR,
    brand_name VARCHAR,
    primary_color VARCHAR,
    secondary_color VARCHAR,
    accent_color VARCHAR,
    background_color VARCHAR,
    text_color VARCHAR,
    font_family VARCHAR,
    logo_url VARCHAR,
    logo_dark_url VARCHAR,
    favicon_url VARCHAR,
    custom_css TEXT,
    custom_js TEXT,
    show_powered_by BOOLEAN,
    footer_links JSONB,
    social_links JSONB,
    features JSONB,
    meta_title VARCHAR,
    meta_description TEXT,
    og_image_url VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        o.id,
        o.name,
        o.slug,
        w.brand_name,
        w.primary_color,
        w.secondary_color,
        w.accent_color,
        w.background_color,
        w.text_color,
        w.font_family,
        w.logo_url,
        w.logo_dark_url,
        w.favicon_url,
        w.custom_css,
        w.custom_js,
        w.show_powered_by,
        w.footer_links,
        w.social_links,
        w.features,
        w.meta_title,
        w.meta_description,
        w.og_image_url
    FROM organizations o
    LEFT JOIN whitelabel_configurations w ON o.id = w.organization_id
    WHERE 
        (o.domain = domain_name OR domain_name = ANY(o.custom_domains))
        AND o.status = 'active';
END;
$$ LANGUAGE plpgsql;

-- Create function to check organization limits
CREATE OR REPLACE FUNCTION check_organization_limit(org_id UUID, limit_type VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    current_count INTEGER;
    max_limit INTEGER;
BEGIN
    IF limit_type = 'users' THEN
        SELECT max_users INTO max_limit FROM organizations WHERE id = org_id;
        SELECT COUNT(*) INTO current_count FROM users WHERE organization_id = org_id;
    ELSIF limit_type = 'invoices' THEN
        SELECT max_invoices INTO max_limit FROM organizations WHERE id = org_id;
        SELECT COUNT(*) INTO current_count FROM invoices 
        WHERE seller_id IN (SELECT id FROM users WHERE organization_id = org_id);
    ELSE
        RETURN FALSE;
    END IF;
    
    RETURN current_count < max_limit;
END;
$$ LANGUAGE plpgsql;
