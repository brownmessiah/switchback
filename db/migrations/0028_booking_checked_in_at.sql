-- Issue #06 — QR check-in arrival timestamp.
--
-- `checked_in_at` records when desk/field staff scanned the customer in. It is a
-- NEW timestamp field, NOT a lifecycle state: the `booking_state` enum and the
-- ADR-0003 state machine are UNCHANGED. Nullable (null until scanned), set once
-- on arrival, never overwritten (idempotent re-scan). Completion still flows
-- exclusively through the existing mark-complete / auto-complete path.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "checked_in_at" timestamp with time zone;
--> statement-breakpoint
-- Partial index over checked-in rows only — supports an arrived-customers
-- manifest view without bloating the index for the common (null) case.
CREATE INDEX IF NOT EXISTS "bookings_by_checked_in_at"
  ON "bookings" USING btree ("checked_in_at")
  WHERE "checked_in_at" IS NOT NULL;
