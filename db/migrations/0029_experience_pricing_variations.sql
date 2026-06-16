-- Issue #07 / ADR-0011 revision 2026-06-16 — Named pricing variations. Additive:
-- one normalized child table on experiences (CASCADE delete) carrying a name,
-- optional description, per-person price (numeric(12,2)), optional duration,
-- and an is_active toggle. A valid ACTIVE variation is the TOP arm of the
-- ADR-0011 per-participant pricing chain at Booking-create and is snapshotted
-- onto bookings.price_per_participant_snapshot. Variations SHARE the slot's
-- capacity — no slot/capacity change. Hand-authored per the repo migration
-- policy (never drizzle-kit generate).
CREATE TABLE IF NOT EXISTS "experience_pricing_variations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "experience_id" uuid NOT NULL REFERENCES "experiences"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "price_per_person" numeric(12, 2) NOT NULL,
  "duration_minutes" integer,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "experience_pricing_variations_price_non_negative" CHECK ("price_per_person" >= 0),
  CONSTRAINT "experience_pricing_variations_duration_positive" CHECK ("duration_minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_pricing_variations_by_experience" ON "experience_pricing_variations" USING btree ("experience_id");
