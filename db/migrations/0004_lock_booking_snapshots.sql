-- Manually-authored migration. Drizzle-kit cannot represent plpgsql triggers
-- in its schema model, so this file is hand-edited. The corresponding
-- 0004_snapshot.json is a copy of 0003_snapshot.json (schema unchanged).
--
-- Snapshot rule structural safety net per ADRs 0008 / 0011 / 0016. Once a
-- bookings row exists, the 12 snapshot columns are locked. UPDATEs that
-- mutate any of them are rejected at the database layer — the trigger is
-- the structural floor below the application-layer Server Action guard.
--
-- IS DISTINCT FROM handles NULLs correctly: NULL <> NULL is FALSE,
-- NULL IS DISTINCT FROM 'x' is TRUE. So setting a snapshot column to its
-- existing value (including NULL → NULL) is a no-op that does not raise.

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
--> statement-breakpoint
CREATE TRIGGER bookings_snapshot_lock
BEFORE UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION reject_booking_snapshot_update();
