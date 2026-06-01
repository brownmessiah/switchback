-- Issue #19 / ADR-0003 revision 2026-06-01 — extend the booking_state enum.
--
-- ADD 'pending_payment' (pre-confirmation: row exists, payment not yet captured)
-- and 'no_show' (terminal: vendor-attested customer no-show after slot end).
-- DELIBERATELY NOT adding 'reserved' — reserve-now-pay-later is a payment_mode,
-- not a lifecycle state (an RNPL booking is confirmed / pending_payment).
--
-- Hand-authored per the repo migration policy (never drizzle-kit generate).
-- ALTER TYPE ... ADD VALUE runs in autocommit (the test harness execs each
-- statement individually; production applies via the same numbered-SQL path),
-- and the new labels are not referenced within this migration, so no
-- "unsafe use of new enum value" error.
ALTER TYPE "booking_state" ADD VALUE IF NOT EXISTS 'pending_payment';
--> statement-breakpoint
ALTER TYPE "booking_state" ADD VALUE IF NOT EXISTS 'no_show';
