-- Task 17 — Wallet transaction ledger, promo codes, promo redemptions.
--
-- wallet_transactions: immutable ledger for every wallet movement.
-- promo_codes: admin-created credit-grant promo codes.
-- promo_redemptions: per-user redemption log with unique constraint.

-- Enum for wallet transaction source types
CREATE TYPE wallet_transaction_source AS ENUM (
  'promo',
  'referral',
  'refund',
  'admin',
  'checkout_deduction',
  'expiry'
);
--> statement-breakpoint

-- Wallet transaction ledger
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  balance_type TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  source wallet_transaction_source NOT NULL,
  reference_id TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX wallet_txn_by_user ON wallet_transactions (user_id);
--> statement-breakpoint
CREATE INDEX wallet_txn_by_user_type ON wallet_transactions (user_id, balance_type);
--> statement-breakpoint
CREATE INDEX wallet_txn_by_source ON wallet_transactions (source);
--> statement-breakpoint
CREATE INDEX wallet_txn_by_created ON wallet_transactions (created_at);
--> statement-breakpoint

-- Promo codes
CREATE TABLE promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  credit_amount NUMERIC(14,2) NOT NULL,
  min_booking_amount NUMERIC(14,2),
  max_total_uses INTEGER,
  current_uses INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_by_admin_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX promo_codes_by_code ON promo_codes (code);
--> statement-breakpoint
CREATE INDEX promo_codes_by_active ON promo_codes (active);
--> statement-breakpoint

-- Promo redemptions
CREATE TABLE promo_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  customer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wallet_transaction_id UUID REFERENCES wallet_transactions(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promo_redemption_user_code UNIQUE (promo_code_id, customer_user_id)
);
