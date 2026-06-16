-- Issue #09 / ADR-0005 revision 2026-06-16 — follow-up to 0030. Migration 0030
-- added the `non_cancellable` value to the `cancellation_preset` enum and the
-- bookings snapshot column, but missed the `refund_requests` CHECK constraint
-- on `cancellation_preset_snapshot`, which still only allowed
-- ('flexible','moderate','strict','custom'). A VENDOR-cancelled non_cancellable
-- Booking full-refunds via the inside-policy path and INSERTs a refund_requests
-- row carrying that snapshot — which the old CHECK rejected, rolling back the
-- whole refund transaction and silently denying the Customer their vendor-fault
-- refund. This widens the closed set to include `non_cancellable`.
--
-- (A CUSTOMER cancellation on a non_cancellable Booking routes to Dispute and
-- writes NO refund_requests row, so it never hit this constraint — but the
-- vendor-cancel override does.)
--
-- Postgres cannot ALTER a CHECK in place; drop + re-add. Hand-authored per the
-- repo migration policy (never drizzle-kit generate). Idempotent.
ALTER TABLE "refund_requests" DROP CONSTRAINT IF EXISTS "valid_cancellation_preset_snapshot";--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "valid_cancellation_preset_snapshot" CHECK ("refund_requests"."cancellation_preset_snapshot" IN ('flexible','moderate','strict','non_cancellable','custom'));
