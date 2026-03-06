-- Credit Risk Profiles Table
-- Stores AI/ML-based credit risk assessments using behavioral analysis, payment patterns, and market data

CREATE TABLE IF NOT EXISTS credit_risk_profiles (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Risk Score Components (0-100 scale)
    behavioral_score INTEGER NOT NULL DEFAULT 50 CHECK (behavioral_score >= 0 AND behavioral_score <= 100),
    payment_velocity_score INTEGER NOT NULL DEFAULT 50 CHECK (payment_velocity_score >= 0 AND payment_velocity_score <= 100),
    market_alignment_score INTEGER NOT NULL DEFAULT 50 CHECK (market_alignment_score >= 0 AND market_alignment_score <= 100),
    financial_health_score INTEGER NOT NULL DEFAULT 50 CHECK (financial_health_score >= 0 AND financial_health_score <= 100),
    
    -- Overall AI Risk Score (0-100, lower = better risk)
    risk_score INTEGER NOT NULL DEFAULT 50 CHECK (risk_score >= 0 AND risk_score <= 100),
    previous_risk_score INTEGER,
    risk_change INTEGER DEFAULT 0,
    
    -- Risk Category
    risk_category VARCHAR(50) NOT NULL DEFAULT 'moderate',
    
    -- Dynamic Interest Rate (annual percentage)
    base_rate NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    risk_adjustment NUMERIC(5, 2) NOT NULL DEFAULT 0.00,
    dynamic_rate NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
    
    -- ML Model Inputs/Features (JSONB for flexibility)
    behavioral_features JSONB DEFAULT '{}',
    payment_pattern_features JSONB DEFAULT '{}',
    market_features JSONB DEFAULT '{}',
    
    -- Model Metadata
    model_version VARCHAR(50) DEFAULT 'v1.0',
    model_confidence NUMERIC(5, 2) DEFAULT 0.75,
    prediction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Traditional Credit Score Integration
    credit_score_id INTEGER REFERENCES credit_scores(id),
    
    -- Timestamps
    last_calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE(user_id)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_credit_risk_profiles_user_id ON credit_risk_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_risk_profiles_risk_score ON credit_risk_profiles(risk_score ASC);
CREATE INDEX IF NOT EXISTS idx_credit_risk_profiles_risk_category ON credit_risk_profiles(risk_category);
CREATE INDEX IF NOT EXISTS idx_credit_risk_profiles_last_calculated ON credit_risk_profiles(last_calculated_at DESC);

-- Credit Risk History Table
-- Tracks risk score changes over time for analysis and auditing
CREATE TABLE IF NOT EXISTS credit_risk_history (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- Risk scores at this point in time
    behavioral_score INTEGER NOT NULL,
    payment_velocity_score INTEGER NOT NULL,
    market_alignment_score INTEGER NOT NULL,
    financial_health_score INTEGER NOT NULL,
    risk_score INTEGER NOT NULL,
    risk_change INTEGER NOT NULL,
    risk_category VARCHAR(50) NOT NULL,
    
    -- Rate at this point
    dynamic_rate NUMERIC(5, 2) NOT NULL,
    
    -- Triggers/Reasons for change
    trigger_event VARCHAR(100),
    trigger_description TEXT,
    
    -- Features snapshot
    features_snapshot JSONB DEFAULT '{}',
    
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for risk history queries
CREATE INDEX IF NOT EXISTS idx_credit_risk_history_user ON credit_risk_history(user_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_risk_history_risk_score ON credit_risk_history(risk_score ASC);

-- Risk Factors Table
-- Detailed breakdown of risk factors for transparency
CREATE TABLE IF NOT EXISTS credit_risk_factors (
    id SERIAL PRIMARY KEY,
    risk_profile_id INTEGER NOT NULL REFERENCES credit_risk_profiles(id) ON DELETE CASCADE,
    
    -- Factor identification
    factor_name VARCHAR(100) NOT NULL,
    factor_category VARCHAR(50) NOT NULL,
    factor_weight NUMERIC(5, 4) DEFAULT 0.0,
    
    -- Factor analysis
    factor_value NUMERIC(10, 4),
    factor_impact VARCHAR(20) NOT NULL CHECK (factor_impact IN ('positive', 'negative', 'neutral')),
    factor_description TEXT,
    
    -- Benchmark comparison
    benchmark_value NUMERIC(10, 4),
    percentile_rank NUMERIC(5, 2),
    
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for risk factors
CREATE INDEX IF NOT EXISTS idx_credit_risk_factors_profile ON credit_risk_factors(risk_profile_id);
CREATE INDEX IF NOT EXISTS idx_credit_risk_factors_category ON credit_risk_factors(factor_category);

-- Market Data Cache Table
-- Stores external market data for risk calculations
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

-- Index for market data cache
CREATE INDEX IF NOT EXISTS idx_market_data_cache_type_key ON market_data_cache(data_type, data_key);
CREATE INDEX IF NOT EXISTS idx_market_data_cache_expires ON market_data_cache(expires_at);

-- Trigger for updated_at
CREATE TRIGGER update_credit_risk_profiles_updated_at
    BEFORE UPDATE ON credit_risk_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE credit_risk_profiles IS 'AI/ML-based credit risk profiles using behavioral analysis and market data';
COMMENT ON TABLE credit_risk_history IS 'Historical tracking of credit risk score changes';
COMMENT ON TABLE credit_risk_factors IS 'Detailed risk factor breakdowns for transparency';
COMMENT ON TABLE market_data_cache IS 'Cached external market data for risk calculations';

COMMENT ON COLUMN credit_risk_profiles.behavioral_score IS 'Score based on user behavioral patterns (login frequency, activity patterns)';
COMMENT ON COLUMN credit_risk_profiles.payment_velocity_score IS 'Score based on speed of payments and consistency';
COMMENT ON COLUMN credit_risk_profiles.market_alignment_score IS 'Score based on alignment with market trends and benchmarks';
COMMENT ON COLUMN credit_risk_profiles.financial_health_score IS 'Score based on overall financial health indicators';
COMMENT ON COLUMN credit_risk_profiles.risk_score IS 'Overall AI-generated risk score (0-100, lower is better)';
COMMENT ON COLUMN credit_risk_profiles.dynamic_rate IS 'Risk-adjusted interest rate based on AI analysis';

