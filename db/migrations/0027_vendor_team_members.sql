DO $$ BEGIN
  CREATE TYPE "vendor_member_role" AS ENUM ('owner', 'manager', 'booking_staff', 'guide', 'accountant');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "vendor_member_status" AS ENUM ('active', 'inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_team_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "vendor_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "member_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "vendor_member_role" NOT NULL,
  "status" "vendor_member_status" DEFAULT 'active' NOT NULL,
  "invited_at" timestamp with time zone,
  "last_active_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_team_members_vendor_member_unique" ON "vendor_team_members" USING btree ("vendor_user_id", "member_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_team_members_by_member" ON "vendor_team_members" USING btree ("member_user_id");
--> statement-breakpoint
ALTER TABLE "vendor_team_members" ADD CONSTRAINT "vendor_team_members_no_owner_role" CHECK ("role" <> 'owner');
