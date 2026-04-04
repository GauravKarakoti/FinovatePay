-- =============================================================================
-- Migration 020: Multi-Party Conditional Escrow (FK STANDARDIZED TO INTEGER)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. MAIN ESCROW TABLE (UNCHANGED - SOURCE OF TRUTH)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS multi_party_escrows (
    id               BIGSERIAL    PRIMARY KEY,
    escrow_id        UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    invoice_id       VARCHAR(100) REFERENCES invoices(invoice_id) ON DELETE SET NULL,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    total_amount     NUMERIC(20, 6) NOT NULL CHECK (total_amount > 0),
    released_amount  NUMERIC(20, 6) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
    currency         VARCHAR(32)  NOT NULL DEFAULT 'USDC',
    token_address    VARCHAR(42),
    status           VARCHAR(30)  NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'active', 'released', 'cancelled', 'disputed')),
    on_chain_tx_hash VARCHAR(66),
    expires_at       TIMESTAMP,
    
    -- ✅ BASE STANDARD (INTEGER)
    created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    
    metadata         JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_mpe_released_lte_total CHECK (released_amount <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_mpe_invoice_id  ON multi_party_escrows(invoice_id);
CREATE INDEX IF NOT EXISTS idx_mpe_status      ON multi_party_escrows(status);
CREATE INDEX IF NOT EXISTS idx_mpe_created_by  ON multi_party_escrows(created_by);
CREATE INDEX IF NOT EXISTS idx_mpe_expires_at  ON multi_party_escrows(expires_at)
WHERE expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. ESCROW PARTICIPANTS (FIXED)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_participants (
    id             BIGSERIAL    PRIMARY KEY,
    escrow_id      UUID         NOT NULL
                       REFERENCES multi_party_escrows(escrow_id) ON DELETE CASCADE,

    -- ✅ FIX: UUID → INTEGER
    user_id        INTEGER      REFERENCES users(id) ON DELETE SET NULL,

    wallet_address VARCHAR(42)  NOT NULL,
    role           VARCHAR(50)  NOT NULL
                       CHECK (role IN ('buyer', 'seller', 'supplier', 'logistics', 'arbiter')),
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    joined_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata       JSONB        NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT uq_escrow_participant UNIQUE (escrow_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_ep_escrow_id     ON escrow_participants(escrow_id);
CREATE INDEX IF NOT EXISTS idx_ep_user_id       ON escrow_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_ep_wallet        ON escrow_participants(wallet_address);

-- ---------------------------------------------------------------------------
-- 3. ESCROW MILESTONES (NO USER FK HERE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_milestones (
    id                       BIGSERIAL     PRIMARY KEY,
    escrow_id                UUID          NOT NULL
                                 REFERENCES multi_party_escrows(escrow_id) ON DELETE CASCADE,
    title                    VARCHAR(255)  NOT NULL,
    description              TEXT,
    amount                   NUMERIC(20, 6) NOT NULL CHECK (amount > 0),
    required_approvals       INTEGER       NOT NULL DEFAULT 1 CHECK (required_approvals > 0),
    approval_count           INTEGER       NOT NULL DEFAULT 0 CHECK (approval_count >= 0),
    status                   VARCHAR(30)   NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'in_progress', 'approved', 'disputed', 'cancelled')),
    order_index              INTEGER       NOT NULL DEFAULT 0,
    on_chain_milestone_index INTEGER,
    tx_hash                  VARCHAR(66),
    metadata                 JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_em_approval_count_lte_required
        CHECK (approval_count <= required_approvals)
);

CREATE INDEX IF NOT EXISTS idx_em_escrow_id   ON escrow_milestones(escrow_id);
CREATE INDEX IF NOT EXISTS idx_em_status      ON escrow_milestones(status);
CREATE INDEX IF NOT EXISTS idx_em_order       ON escrow_milestones(escrow_id, order_index);

-- ---------------------------------------------------------------------------
-- 4. MILESTONE APPROVALS (FIXED)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS milestone_approvals (
    id             BIGSERIAL    PRIMARY KEY,
    milestone_id   BIGINT       NOT NULL
                       REFERENCES escrow_milestones(id) ON DELETE CASCADE,

    -- ✅ FIX: UUID → INTEGER
    user_id        INTEGER      REFERENCES users(id) ON DELETE SET NULL,

    wallet_address VARCHAR(42)  NOT NULL,
    tx_hash        VARCHAR(66),
    block_number   BIGINT,
    approved_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_milestone_approval UNIQUE (milestone_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_ma_milestone_id  ON milestone_approvals(milestone_id);
CREATE INDEX IF NOT EXISTS idx_ma_wallet        ON milestone_approvals(wallet_address);
CREATE INDEX IF NOT EXISTS idx_ma_user_id       ON milestone_approvals(user_id);

-- ---------------------------------------------------------------------------
-- 5. updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_mpe_updated_at'
    ) THEN
        CREATE TRIGGER trg_mpe_updated_at
            BEFORE UPDATE ON multi_party_escrows
            FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_em_updated_at'
    ) THEN
        CREATE TRIGGER trg_em_updated_at
            BEFORE UPDATE ON escrow_milestones
            FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();
    END IF;
END $$;