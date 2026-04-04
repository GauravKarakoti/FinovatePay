-- =============================================================================
-- CREDIT RISK SYSTEM (FINAL - FK STANDARDIZED TO INTEGER)
-- =============================================================================

-- =========================
-- 1. CREDIT RISK PROFILES
-- =========================
CREATE TABLE IF NOT EXISTS credit_risk_profiles (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    behavioral_score INTEGER NOT NULL DEFAULT 50 CHECK (behavioral_score BETWEEN 0 AND 100),
    payment_velocity_score INTEGER NOT NULL DEFAULT 50 CHECK (payment_velocity_score BETWEEN 0 AND 100),
    market_alignment_score INTEGER NOT NULL DEFAULT 50 CHECK (market_alignment_score BETWEEN 0 AND 100),
    financial_health_score INTEGER NOT NULL DEFAULT 50 CHECK (financial_health_score BETWEEN 0 AND 100),
    
    risk_score INTEGER NOT NULL DEFAULT 50 CHECK (risk_score BETWEEN 0 AND 100),
    previous_risk_score INTEGER,
    risk_change INTEGER DEFAULT 0,
    
    risk_category VARCHAR(50) NOT NULL DEFAULT 'moderate',
    
    base_rate NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    risk_adjustment NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    dynamic_rate NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    
    behavioral_features JSONB DEFAULT '{}',
    payment_pattern_features JSONB DEFAULT '{}',
    market_features JSONB DEFAULT '{}',
    
    model_version VARCHAR(50) DEFAULT 'v1.0',
    model_confidence NUMERIC(5, 2) DEFAULT 0.75,
    prediction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    credit_score_id INTEGER REFERENCES credit_score_history(id),
    
    last_calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

-- =========================
-- 2. CREDIT RISK HISTORY (FIXED)
-- =========================
CREATE TABLE IF NOT EXISTS credit_risk_history (
    id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    behavioral_score INTEGER NOT NULL,
    payment_velocity_score INTEGER NOT NULL,
    market_alignment_score INTEGER NOT NULL,
    financial_health_score INTEGER NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_change INTEGER NOT NULL,
    risk_category VARCHAR(50) NOT NULL,
    
    dynamic_rate NUMERIC(5, 2) NOT NULL,
    
    trigger_event VARCHAR(100),
    trigger_description TEXT,
    
    features_snapshot JSONB DEFAULT '{}',
    
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- 3. CREDIT RISK FACTORS
-- =========================
CREATE TABLE IF NOT EXISTS credit_risk_factors (
    id SERIAL PRIMARY KEY,
    risk_profile_id INTEGER NOT NULL REFERENCES credit_risk_profiles(id) ON DELETE CASCADE,
    
    factor_name VARCHAR(100) NOT NULL,
    factor_category VARCHAR(50) NOT NULL,
    factor_weight NUMERIC(5, 4) DEFAULT 0.0,
    
    factor_value NUMERIC(10, 4),
    factor_impact VARCHAR(20) NOT NULL 
        CHECK (factor_impact IN ('positive', 'negative', 'neutral')),
    factor_description TEXT,
    
    benchmark_value NUMERIC(10, 4),
    percentile_rank NUMERIC(5, 2),
    
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- 4. MARKET DATA CACHE
-- =========================
CREATE TABLE IF NOT EXISTS market_data_cache (
    id SERIAL PRIMARY KEY,
    data_type VARCHAR(50) NOT NULL,
    data_key VARCHAR(100) NOT NULL,
    data_value JSONB NOT NULL,
    source VARCHAR(100),
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    
    UNIQUE(data_type, data_key)
);

-- =========================
-- INDEXES
-- =========================

-- credit_risk_profiles
CREATE INDEX IF NOT EXISTS idx_crp_user_id 
ON credit_risk_profiles(user_id);

CREATE INDEX IF NOT EXISTS idx_crp_risk_score 
ON credit_risk_profiles(risk_score ASC);

CREATE INDEX IF NOT EXISTS idx_crp_risk_category 
ON credit_risk_profiles(risk_category);

CREATE INDEX IF NOT EXISTS idx_crp_last_calculated 
ON credit_risk_profiles(last_calculated_at DESC);

-- credit_risk_history
CREATE INDEX IF NOT EXISTS idx_crh_user 
ON credit_risk_history(user_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crh_risk_score 
ON credit_risk_history(risk_score ASC);

-- credit_risk_factors
CREATE INDEX IF NOT EXISTS idx_crf_profile 
ON credit_risk_factors(risk_profile_id);

CREATE INDEX IF NOT EXISTS idx_crf_category 
ON credit_risk_factors(factor_category);

-- market_data_cache
CREATE INDEX IF NOT EXISTS idx_mdc_type_key 
ON market_data_cache(data_type, data_key);

CREATE INDEX IF NOT EXISTS idx_mdc_expires 
ON market_data_cache(expires_at);

-- =========================
-- TRIGGER FUNCTION
-- =========================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =========================
-- TRIGGERS (SAFE CREATE)
-- =========================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'trg_credit_risk_profiles_updated_at'
    ) THEN
        CREATE TRIGGER trg_credit_risk_profiles_updated_at
        BEFORE UPDATE ON credit_risk_profiles
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- =========================
-- COMMENTS
-- =========================
COMMENT ON TABLE credit_risk_profiles IS 
'AI/ML-based credit risk profiles using behavioral analysis and market data';

COMMENT ON TABLE credit_risk_history IS 
'Historical tracking of credit risk score changes';

COMMENT ON TABLE credit_risk_factors IS 
'Detailed risk factor breakdowns for transparency';

COMMENT ON TABLE market_data_cache IS 
'Cached external market data for risk calculations';

COMMENT ON COLUMN credit_risk_profiles.behavioral_score IS 
'Score based on user behavioral patterns';

COMMENT ON COLUMN credit_risk_profiles.payment_velocity_score IS 
'Score based on payment consistency';

COMMENT ON COLUMN credit_risk_profiles.market_alignment_score IS 
'Score based on market alignment';

COMMENT ON COLUMN credit_risk_profiles.financial_health_score IS 
'Score based on financial indicators';

COMMENT ON COLUMN credit_risk_profiles.risk_score IS 
'Overall AI-generated risk score (0-100, lower is better)';

COMMENT ON COLUMN credit_risk_profiles.dynamic_rate IS 
'Risk-adjusted interest rate based on AI analysis';