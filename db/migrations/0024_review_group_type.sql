-- Issue #18 / DECISION D5 — Reviews enrichment. Additive: a capture-time
-- group-type for Reviews. Travel month is DERIVED from the Booking's
-- Availability slot start_at (no new column). The column is NULLABLE so
-- existing Reviews (authored before this feature) keep a null group type and
-- nothing about the existing PDP / E2E selectors breaks. Hand-authored per the
-- repo migration policy (never drizzle-kit generate).
DO $$ BEGIN
  CREATE TYPE "review_group_type" AS ENUM ('solo', 'couple', 'friends', 'family', 'corporate');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN IF NOT EXISTS "group_type" "review_group_type";
