-- ADR-0016: Add payout processing state to bookings for admin approval flow.
-- pending → approved / rejected / held.

CREATE TYPE "public"."payout_state" AS ENUM('pending', 'approved', 'rejected', 'held');
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payout_state" "payout_state" DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payout_rejection_reason" text;
--> statement-breakpoint
CREATE INDEX "bookings_by_payout_state" ON "bookings" USING btree ("payout_state");
