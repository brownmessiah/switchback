-- Vendor application decision (amends ADR-0007).
--
-- Before this, an admin's accept/reject on a Vendor left NO durable trace: the
-- approve path only bumped vendor_profiles.kyc_tier, and reject wrote an
-- audit_logs row and nothing else. A rejected Vendor was therefore
-- indistinguishable from one nobody had looked at yet, and the Vendor was
-- never told.
--
-- The decision is a SEPARATE axis from kyc_tier, deliberately:
--   * kyc_tier      = verification LEVEL. Drives the ADR-0007 tier caps
--                     (price / combo / multi-day / capacity).
--   * application_status = the admin's DECISION. Gates whether the Vendor's
--                     listings may go live at all.
-- A Vendor can be identity-verified yet rejected (caps would allow publishing;
-- the decision does not), so collapsing these into one column would lose
-- information.
--
-- Product rule this encodes: a Vendor may always draft and submit listings for
-- review -- ADR-0007's Tier-2 gate REQUIRES at least one Experience submitted
-- for review before approval is possible -- but nothing goes live until
-- application_status = 'approved'. Rejection returns queued listings to draft.
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate).
-- MUST stay in lockstep with db/schema/vendor-profiles.ts (the drizzle
-- definition also drives the e2e DB via drizzle-kit push).

DO $$ BEGIN
  CREATE TYPE "vendor_application_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "vendor_profiles"
  ADD COLUMN IF NOT EXISTS "application_status" "vendor_application_status"
    DEFAULT 'pending' NOT NULL;
--> statement-breakpoint

ALTER TABLE "vendor_profiles"
  ADD COLUMN IF NOT EXISTS "application_decision_reason" text;
--> statement-breakpoint

ALTER TABLE "vendor_profiles"
  ADD COLUMN IF NOT EXISTS "application_decided_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "vendor_profiles"
  ADD COLUMN IF NOT EXISTS "application_decided_by" text;
--> statement-breakpoint

-- ON DELETE SET NULL, not CASCADE: deleting the admin who made a decision must
-- never delete the Vendor that decision was about.
DO $$ BEGIN
  ALTER TABLE "vendor_profiles"
    ADD CONSTRAINT "vendor_profiles_application_decided_by_users_id_fk"
    FOREIGN KEY ("application_decided_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

-- The admin queue reads "who is waiting on a decision", so index that path.
CREATE INDEX IF NOT EXISTS "vendor_profiles_by_application_status"
  ON "vendor_profiles" ("application_status");
--> statement-breakpoint

-- Backfill: every Vendor already past the phone tier was, in substance,
-- approved by an admin under the old flow (the only way to leave 'phone' was
-- executeKycApproval). Treating them as pending would yank live listings off
-- the public site the moment the publish gate lands.
UPDATE "vendor_profiles"
  SET "application_status" = 'approved',
      "application_decided_at" = COALESCE("updated_at", now())
  WHERE "kyc_tier" IN ('identity', 'business')
    AND "application_status" = 'pending';
