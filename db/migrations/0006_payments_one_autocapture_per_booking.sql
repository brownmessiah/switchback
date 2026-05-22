-- Task 17 — partial unique index per ADR-0001.
--
-- Defense-in-depth for the partial-pay T-24h auto-capture cron worker.
-- The cron uses SELECT FOR UPDATE on the bookings row to serialise
-- concurrent in-process runs, but this index closes any remaining
-- structural gap (e.g. two distinct serverless containers racing past
-- the row-lock) by making it impossible at the Postgres layer for two
-- `auto_capture_t_minus_24h` rows to coexist for the same booking.
--
-- Partial — only the auto_capture rows are constrained; booking_create
-- / escrow_full_capture / refund_reverse / manual_admin rows continue
-- to coexist on the same booking_id.

CREATE UNIQUE INDEX payments_one_autocapture_per_booking
ON payments (booking_id)
WHERE capture_trigger = 'auto_capture_t_minus_24h';
