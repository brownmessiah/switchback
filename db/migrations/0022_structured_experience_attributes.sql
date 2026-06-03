-- Issue #01 / ADR-0017 — Structured Experience Attributes. Additive: the
-- difficulty enum, eleven new nullable / array-default-empty columns on
-- experiences with their CHECKs, and one normalized child table for the
-- Vendor-authored per-Experience itinerary (mirrors ADR-0009). Every column
-- is nullable or array-default-empty so this migration never breaks the
-- drizzle-kit push seed, the PDP, or any E2E selector. Hand-authored per the
-- repo migration policy (never drizzle-kit generate).
DO $$ BEGIN
  CREATE TYPE "experience_difficulty" AS ENUM ('easy', 'moderate', 'challenging', 'extreme');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "duration_minutes" integer;
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "difficulty" "experience_difficulty";
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "min_age" integer;
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "max_group_size" integer;
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "languages" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "meeting_point" text;
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "season_months" smallint[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "highlights" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "inclusions" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "exclusions" text[] DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "what_to_bring" text[] DEFAULT '{}';
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "experiences" ADD CONSTRAINT "experiences_duration_minutes_positive" CHECK ("duration_minutes" > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "experiences" ADD CONSTRAINT "experiences_min_age_non_negative" CHECK ("min_age" >= 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "experiences" ADD CONSTRAINT "experiences_max_group_size_positive" CHECK ("max_group_size" > 0);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "experiences" ADD CONSTRAINT "experiences_season_months_in_range" CHECK ("season_months" <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]);
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "experience_itinerary_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "experience_id" uuid NOT NULL REFERENCES "experiences"("id") ON DELETE CASCADE,
  "step_order" integer NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "day_offset" integer,
  "duration_minutes" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "experience_itinerary_steps_order_unq" UNIQUE ("experience_id", "step_order")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "experience_itinerary_steps_by_experience" ON "experience_itinerary_steps" USING btree ("experience_id");
