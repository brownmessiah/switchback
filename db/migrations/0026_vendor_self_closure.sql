ALTER TABLE "vendor_profiles" ADD COLUMN "closed_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "vendor_profiles" ADD COLUMN "closure_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_profiles_by_closed_at" ON "vendor_profiles" USING btree ("closed_at");
