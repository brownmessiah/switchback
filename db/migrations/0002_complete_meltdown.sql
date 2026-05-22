ALTER TABLE "bookings" ADD COLUMN "payout_method_snapshot" "payout_method";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payout_destination_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "payout_snapshot_consistency" CHECK (("bookings"."payout_method_snapshot" IS NULL AND "bookings"."payout_destination_snapshot" IS NULL)
       OR ("bookings"."payout_method_snapshot" IS NOT NULL AND "bookings"."payout_destination_snapshot" IS NOT NULL));