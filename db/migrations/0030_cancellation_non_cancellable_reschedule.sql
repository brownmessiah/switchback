-- Issue #09 / ADR-0005 revision 2026-06-16 — Hybrid cancellation model. Additive
-- and idempotent. Adds a fourth named cancellation preset `non_cancellable`
-- (refund function ALWAYS returns 0 in every window; a Customer cancellation
-- routes to Dispute per ADR-0003 — NO per-Experience free-form refund fields,
-- the preset-transparency wedge is preserved), plus a per-Experience
-- `reschedule_allowed` flag (PRD default ON) that is snapshotted onto the
-- Booking at create via `reschedule_allowed_snapshot` so a later policy change
-- never alters an existing Booking. Hand-authored per the repo migration policy
-- (never drizzle-kit generate). The test harness splits on statement-breakpoint
-- and runs each statement separately, so ALTER TYPE ... ADD VALUE then later use
-- of the value is fine.
ALTER TYPE "cancellation_preset" ADD VALUE IF NOT EXISTS 'non_cancellable';
--> statement-breakpoint
ALTER TABLE "experiences" ADD COLUMN IF NOT EXISTS "reschedule_allowed" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "reschedule_allowed_snapshot" boolean NOT NULL DEFAULT true;
