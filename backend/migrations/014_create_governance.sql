-- Governance Module Database Migration
-- Creates tables for governance proposals and votes

-- Governance Proposals Table
CREATE TABLE IF NOT EXISTS governance_proposals (
    id SERIAL PRIMARY KEY,
    proposal_id VARCHAR(66) NOT NULL UNIQUE, -- Ethereum transaction hash format
    proposal_hash VARCHAR(66), -- Internal proposal hash
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'PARAMETER_UPDATE',
        'FEE_UPDATE',
        'TREASURY_UPDATE',
        'EMERGENCY',
        'UPGRADE',
        'GENERAL'
    )),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN (
        'PENDING',
        'ACTIVE',
        'CANCELED',
        'DEFEATED',
        'SUCCEEDED',
        'QUEUED',
        'EXECUTED',
        'EXPIRED'
    )),
    proposer_wallet VARCHAR(66) NOT NULL,
    target_contract VARCHAR(66),
    calldata BYTEA,
    value BIGINT DEFAULT 0,
    
    -- Timing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    start_block BIGINT,
    end_block BIGINT,
    execution_time TIMESTAMP WITH TIME ZONE,
    executed_at TIMESTAMP WITH TIME ZONE,
    cancelled_at TIMESTAMP WITH TIME ZONE,
    
    -- Vote counts
    for_votes BIGINT DEFAULT 0,
    against_votes BIGINT DEFAULT 0,
    abstain_votes BIGINT DEFAULT 0,
    quorum_required BIGINT DEFAULT 0,
    
    -- Additional info
    proposal_threshold BIGINT DEFAULT 0,
    vote_start BIGINT,
    vote_end BIGINT,
    description_hash VARCHAR(66),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    CONSTRAINT unique_proposal UNIQUE (proposal_id)
);

-- Governance Votes Table
CREATE TABLE IF NOT EXISTS governance_votes (
    id SERIAL PRIMARY KEY,
    proposal_id VARCHAR(66) NOT NULL REFERENCES governance_proposals(proposal_id) ON DELETE CASCADE,
    voter_wallet VARCHAR(66) NOT NULL,
    vote_weight BIGINT NOT NULL DEFAULT 0,
    support BOOLEAN NOT NULL, -- true = for, false = against
    support_enum VARCHAR(10) NOT NULL CHECK (support_enum IN ('FOR', 'AGAINST', 'ABSTAIN')),
    
    -- Transaction info
    tx_hash VARCHAR(66),
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_vote UNIQUE (proposal_id, voter_wallet)
);

-- Governance Delegations Table (track delegate relationships)
CREATE TABLE IF NOT EXISTS governance_delegations (
    id SERIAL PRIMARY KEY,
    delegator_wallet VARCHAR(66) NOT NULL,
    delegate_wallet VARCHAR(66) NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0,
    block_number BIGINT,
    block_timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT unique_delegation UNIQUE (delegator_wallet, delegate_wallet)
);

-- Governance Token Holders Table (snapshot of holders)
CREATE TABLE IF NOT EXISTS governance_token_holders (
    id SERIAL PRIMARY KEY,
    wallet VARCHAR(66) NOT NULL UNIQUE,
    balance BIGINT NOT NULL DEFAULT 0,
    votes BIGINT NOT NULL DEFAULT 0,
    delegated_balance BIGINT DEFAULT 0,
    block_number BIGINT,
    last_update TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Governance Parameters Table (track protocol parameters)
CREATE TABLE IF NOT EXISTS governance_parameters (
    id SERIAL PRIMARY KEY,
    parameter_name VARCHAR(100) NOT NULL UNIQUE,
    current_value VARCHAR(500) NOT NULL,
    pending_value VARCHAR(500),
    proposal_id VARCHAR(66),
    execution_time TIMESTAMP WITH TIME ZONE,
    is_governable BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by VARCHAR(66)
);

-- Governance Timelock Queue Table
CREATE TABLE IF NOT EXISTS governance_timelock_queue (
    id SERIAL PRIMARY KEY,
    proposal_id VARCHAR(66) NOT NULL REFERENCES governance_proposals(proposal_id) ON DELETE CASCADE,
    target_contract VARCHAR(66) NOT NULL,
    calldata BYTEA,
    value BIGINT DEFAULT 0,
    eta TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'CANCELLED', 'EXPIRED')),
    executed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    min_delay BIGINT DEFAULT 0
);

-- Governance Events Table (for indexing)
CREATE TABLE IF NOT EXISTS governance_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    proposal_id VARCHAR(66),
    wallet VARCHAR(66),
    data JSONB DEFAULT '{}',
    block_number BIGINT,
    tx_hash VARCHAR(66),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_proposals_status ON governance_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_category ON governance_proposals(category);
CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON governance_proposals(proposer_wallet);
CREATE INDEX IF NOT EXISTS idx_proposals_created ON governance_proposals(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_votes_proposal ON governance_votes(proposal_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON governance_votes(voter_wallet);

CREATE INDEX IF NOT EXISTS idx_delegations_delegate ON governance_delegations(delegate_wallet);
CREATE INDEX IF NOT EXISTS idx_delegations_delegator ON governance_delegations(delegator_wallet);
CREATE INDEX IF NOT EXISTS idx_delegations_active ON governance_delegations(is_active);

CREATE INDEX IF NOT EXISTS idx_holders_votes ON governance_token_holders(votes DESC);

CREATE INDEX IF NOT EXISTS idx_timelock_eta ON governance_timelock_queue(eta);
CREATE INDEX IF NOT EXISTS idx_timelock_proposal ON governance_timelock_queue(proposal_id);

CREATE INDEX IF NOT EXISTS idx_events_proposal ON governance_events(proposal_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON governance_events(event_type);

-- Insert initial governance parameters
INSERT INTO governance_parameters (parameter_name, current_value, is_governable, updated_at) VALUES
    ('feePercentage', '50', true, NOW()),
    ('minimumEscrowAmount', '100', true, NOW()),
    ('quorumPercentage', '4', true, NOW()),
    ('votingDelay', '7200', true, NOW()),
    ('votingPeriod', '50400', true, NOW()),
    ('proposalThreshold', '100000000000000000000000', true, NOW())
ON CONFLICT (parameter_name) DO NOTHING;

-- Comments
COMMENT ON TABLE governance_proposals IS 'Stores all governance proposals in the system';
COMMENT ON TABLE governance_votes IS 'Tracks individual votes on proposals';
COMMENT ON TABLE governance_delegations IS 'Tracks voting power delegations';
COMMENT ON TABLE governance_token_holders IS 'Snapshot of token holders with voting power';
COMMENT ON TABLE governance_parameters IS 'Protocol parameters that can be governed';
COMMENT ON TABLE governance_timelock_queue IS 'Timelock queue for executed proposals';
COMMENT ON TABLE governance_events IS 'Index of governance events for easy querying';

