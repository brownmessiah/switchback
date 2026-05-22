-- Manually-authored migration. Two structural fixes pulled forward from M3
-- per the security review of M2 Phase 1:
--
-- 1) audit_logs append-only enforcement at the DB layer. The lib/audit/write
--    helper is the only intended write path, but until now there was no
--    structural floor — any code with the `db` handle could UPDATE or DELETE
--    rows. The trigger raises on either operation; INSERTs are not affected.
--    Audit evidence backs tax-authority Form 26Q and GST invoices, so this
--    floor is non-negotiable before booking-create + refund-flow start
--    writing rows.
--
-- 2) Slug-safe CHECK constraints on commission_tiers.name and
--    pricing_tiers.name. These names embed into booking snapshot basis
--    labels (e.g. `festival:diwali_2026`) and that string can land on
--    customer-facing surfaces (booking detail, dispute review). Free-text
--    admin-controlled values are a latent stored-XSS / display-corruption
--    risk; constrain to `^[a-z0-9_-]+$` so HTML can never appear there.

CREATE OR REPLACE FUNCTION reject_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only; UPDATE and DELETE are not permitted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
FOR EACH ROW
EXECUTE FUNCTION reject_audit_log_mutation();
--> statement-breakpoint
ALTER TABLE commission_tiers
  ADD CONSTRAINT commission_tier_name_slug
  CHECK (name ~ '^[a-z0-9_-]+$');
--> statement-breakpoint
ALTER TABLE pricing_tiers
  ADD CONSTRAINT pricing_tier_name_slug
  CHECK (name ~ '^[a-z0-9_-]+$');
