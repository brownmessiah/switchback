-- ADR-0016 (2026-06-18 amendment, D1+D3) -- the Payout Batch aggregate + the
-- 5pm-IST cron Payout Batch send path.
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate). The
-- test harness execs each statement individually (split on the
-- statement-breakpoint marker); production applies via the same numbered-SQL path.
--
-- Extend the per-Booking payout_state enum with the Payout Batch send lifecycle
-- values. ALTER TYPE ADD VALUE runs in autocommit and the new labels are not
-- referenced within this migration, so the new-enum-value restriction does not
-- bite (mirrors migration 0020).
ALTER TYPE "payout_state" ADD VALUE IF NOT EXISTS 'processing';
--> statement-breakpoint
ALTER TYPE "payout_state" ADD VALUE IF NOT EXISTS 'paid';
--> statement-breakpoint
ALTER TYPE "payout_state" ADD VALUE IF NOT EXISTS 'failed';
--> statement-breakpoint
ALTER TYPE "payout_state" ADD VALUE IF NOT EXISTS 'reversed';
--> statement-breakpoint
-- The Payout Batch lifecycle enum (separate from the approval-flow enum above).
CREATE TYPE "public"."payout_batch_status" AS ENUM('processing', 'paid', 'failed', 'reversed');
--> statement-breakpoint
-- The Payout Batch aggregate table. One transfer per (vendor, destination) per
-- daily 5pm-IST batch; member Bookings link back via payout_batch_id.
CREATE TABLE IF NOT EXISTS "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_user_id" text NOT NULL,
	"destination_fingerprint" text NOT NULL,
	"razorpay_fund_account_id" text NOT NULL,
	"batch_day" text NOT NULL,
	"status" "payout_batch_status" DEFAULT 'processing' NOT NULL,
	"amount_net_rupees" numeric(14, 2) NOT NULL,
	"tds_total" numeric(14, 2) NOT NULL,
	"tcs_total" numeric(14, 2) NOT NULL,
	"razorpay_payout_id" text,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payouts_vendor_user_id_users_id_fk" FOREIGN KEY ("vendor_user_id") REFERENCES "users"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
-- The at-most-once guard: one Payout Batch per (vendor, destination, day).
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_vendor_destination_batchday" ON "payouts" USING btree ("vendor_user_id","destination_fingerprint","batch_day");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_by_status" ON "payouts" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payouts_by_vendor" ON "payouts" USING btree ("vendor_user_id");
--> statement-breakpoint
-- Link member Bookings back to their Payout Batch. Plain column + FK declared
-- here only (no Drizzle references) to avoid a bookings-payouts import edge.
-- ON DELETE restrict: a Booking already sent in a Batch blocks the Batch row
-- deletion.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "payout_batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_payout_batch_id_payouts_id_fk" FOREIGN KEY ("payout_batch_id") REFERENCES "payouts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_by_payout_batch" ON "bookings" USING btree ("payout_batch_id");
