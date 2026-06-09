-- Issue #19 — Review photos: upload + moderation + render. A DEDICATED table
-- (NOT polymorphic media_assets, which carries no moderation status) so that
-- Customer-uploaded Review photos run through an explicit pending →
-- approved/rejected lifecycle. Per DECISION D0/D5 only 'approved' photos ever
-- render publicly. Hand-authored per the repo migration policy (never
-- drizzle-kit generate).
DO $$ BEGIN
  CREATE TYPE "review_photo_status" AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_photos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "review_id" uuid NOT NULL REFERENCES "reviews"("id") ON DELETE CASCADE,
  "uploaded_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "storage_key" text NOT NULL,
  "url" text NOT NULL,
  "status" "review_photo_status" DEFAULT 'pending' NOT NULL,
  "alt_text" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_photos_review_id_idx" ON "review_photos" ("review_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_photos_status_idx" ON "review_photos" ("status");
