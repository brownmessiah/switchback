-- ADR-0016: GST TCS (Section 52) snapshot columns on bookings + Vendor
-- income-tax taxpayer type for the Section 194-O(2) ₹5L threshold exemption.
-- Also extends the booking snapshot-lock trigger (migration 0004) to cover
-- the two new TCS snapshot columns.

CREATE TYPE "public"."vendor_taxpayer_type" AS ENUM('individual', 'huf', 'company', 'firm', 'other');
--> statement-breakpoint
ALTER TABLE "vendor_profiles" ADD COLUMN "taxpayer_type" "vendor_taxpayer_type";
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "tcs_amount_snapshot" numeric(14, 2) DEFAULT '0.00' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "tcs_rate_snapshot" numeric(5, 2) DEFAULT '0.50' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "non_negative_tcs" CHECK ("bookings"."tcs_amount_snapshot" >= 0);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "tcs_rate_in_range" CHECK ("bookings"."tcs_rate_snapshot" >= 0 AND "bookings"."tcs_rate_snapshot" <= 100);
--> statement-breakpoint
-- Extend the snapshot-lock trigger (migration 0004) to cover the two new TCS
-- snapshot columns. CREATE OR REPLACE FUNCTION updates the body in place; the
-- bookings_snapshot_lock trigger already references it by name.
CREATE OR REPLACE FUNCTION reject_booking_snapshot_update()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.gross_total_snapshot IS DISTINCT FROM OLD.gross_total_snapshot
     OR NEW.price_per_participant_snapshot IS DISTINCT FROM OLD.price_per_participant_snapshot
     OR NEW.pricing_basis_snapshot IS DISTINCT FROM OLD.pricing_basis_snapshot
     OR NEW.commission_rate_snapshot IS DISTINCT FROM OLD.commission_rate_snapshot
     OR NEW.commission_basis_snapshot IS DISTINCT FROM OLD.commission_basis_snapshot
     OR NEW.cancellation_preset_snapshot IS DISTINCT FROM OLD.cancellation_preset_snapshot
     OR NEW.tds_amount_snapshot IS DISTINCT FROM OLD.tds_amount_snapshot
     OR NEW.tcs_amount_snapshot IS DISTINCT FROM OLD.tcs_amount_snapshot
     OR NEW.tcs_rate_snapshot IS DISTINCT FROM OLD.tcs_rate_snapshot
     OR NEW.gst_rate_on_commission_snapshot IS DISTINCT FROM OLD.gst_rate_on_commission_snapshot
     OR NEW.vendor_pan_snapshot IS DISTINCT FROM OLD.vendor_pan_snapshot
     OR NEW.vendor_is_resident_snapshot IS DISTINCT FROM OLD.vendor_is_resident_snapshot
     OR NEW.payout_method_snapshot IS DISTINCT FROM OLD.payout_method_snapshot
     OR NEW.payout_destination_snapshot IS DISTINCT FROM OLD.payout_destination_snapshot
  THEN
    RAISE EXCEPTION 'snapshot columns on bookings are immutable after insert (ADRs 0008/0011/0016)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
