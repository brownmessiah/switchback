-- Issue #20 / ADR-0009 — TripGroup model: the three tables + enums, and the
-- FK on the pre-existing bookings.trip_group_id column. Hand-authored per the
-- repo migration policy (never drizzle-kit generate).
DO $$ BEGIN
  CREATE TYPE "trip_group_visibility" AS ENUM ('private', 'public_all', 'public_women_only');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "trip_group_membership_rule" AS ENUM ('auto_accept', 'host_approval');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "trip_group_status" AS ENUM ('forming', 'planning', 'booking', 'traveling', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "trip_group_member_role" AS ENUM ('host', 'member');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "trip_group_member_status" AS ENUM ('pending', 'active');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "host_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "destination_slugs" text[] DEFAULT '{}' NOT NULL,
  "target_date_window_start" date,
  "target_date_window_end" date,
  "budget_range" jsonb,
  "interest_tags" text[] DEFAULT '{}' NOT NULL,
  "visibility" "trip_group_visibility" DEFAULT 'public_all' NOT NULL,
  "membership_rule" "trip_group_membership_rule" DEFAULT 'auto_accept' NOT NULL,
  "max_members" integer NOT NULL,
  "status" "trip_group_status" DEFAULT 'forming' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trip_groups_max_members_range" CHECK ("max_members" BETWEEN 2 AND 12)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_group_members" (
  "trip_group_id" uuid NOT NULL REFERENCES "trip_groups"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "trip_group_member_role" DEFAULT 'member' NOT NULL,
  "status" "trip_group_member_status" DEFAULT 'active' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trip_group_members_pkey" PRIMARY KEY ("trip_group_id", "user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trip_group_itinerary_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "trip_group_id" uuid NOT NULL REFERENCES "trip_groups"("id") ON DELETE CASCADE,
  "day_offset" integer NOT NULL,
  "time_band" text NOT NULL,
  "experience_id" uuid REFERENCES "experiences"("id") ON DELETE SET NULL,
  "free_text" text,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "updated_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Wire the pre-existing bookings.trip_group_id column to trip_groups. SET NULL
-- on group delete keeps Bookings intact (payment/refund isolation, ADR-0009).
DO $$ BEGIN
  ALTER TABLE "bookings"
    ADD CONSTRAINT "bookings_trip_group_id_fk"
    FOREIGN KEY ("trip_group_id") REFERENCES "trip_groups"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_groups_by_visibility_status" ON "trip_groups" USING btree ("visibility", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_groups_by_host" ON "trip_groups" USING btree ("host_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_group_members_by_user" ON "trip_group_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_group_members_by_group_status" ON "trip_group_members" USING btree ("trip_group_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trip_group_itinerary_slots_by_group" ON "trip_group_itinerary_slots" USING btree ("trip_group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_by_trip_group" ON "bookings" USING btree ("trip_group_id") WHERE "trip_group_id" IS NOT NULL;
