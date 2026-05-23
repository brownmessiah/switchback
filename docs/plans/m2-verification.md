# M2 Money-Path verification checklist

> **Status as of 2026-05-23:** All M2 tasks (1–24) are code-complete with 467 unit/integration tests passing. UI pages (Tasks 19, 21, 23) and the checkout flow (Task 20) are built but require browser-driven verification with live Razorpay test credentials. E2E spec (Task 24) skips in CI when creds are missing.

This document is the verification gate before tagging `v0.2-money-path`.

---

## Backend — invariants verified by the test suite (430 tests)

### Phase 0 — Schema (Tasks 1–3)
- [x] `refund_requests` table with enum CHECK constraints + partial unique index `one_active_refund_per_booking`
- [x] `payments.refund_request_id` FK with `refund_reverse_requires_request` CHECK
- [x] `bookings.payout_method_snapshot` + `payout_destination_snapshot` with both-or-neither CHECK
- [x] Migration 0004 trigger `bookings_snapshot_lock` rejects UPDATEs to 12 snapshot columns
- [x] Migration 0005 trigger `audit_logs_immutable` rejects UPDATE and DELETE on `audit_logs`
- [x] Migration 0006 partial unique index `payments_one_autocapture_per_booking`

### Phase 1 — Pure resolvers (Tasks 4–8)
- [x] `quoteRefund` — Flexible / Moderate / Strict windows, vendor-cancelled, outside-policy (refund-policy.test.ts)
- [x] `resolveCommission` — festival tier → exp override → vendor default → platform default (commission-resolver.test.ts)
- [x] `resolvePricing` — pricing tier → group-size bracket → base (pricing-resolver.test.ts)
- [x] `quoteTds` — 1% Section 194-O for resident vendors with PAN (tds-calculator.test.ts)
- [x] `quoteGstOnCommission` — 18% IGST (gst-calculator.test.ts)
- [x] `writeAuditLog` — append-only helper, accepts both `db` and `tx` (audit/write.test.ts)

### Phase 1 — Booking-create transaction (Task 9)
- [x] Single `db.transaction(...)` SELECT FOR UPDATE on slot
- [x] All 12 snapshot columns populated from resolver outputs
- [x] Capacity decrement + `sold_out` transition on cap
- [x] RNPL rejected with `RNPL_DEFERRED_TO_V2`
- [x] <48h partial_pay → coerced to full_upfront with audit flag
- [x] >Rs.25k partial_pay → `captureTrigger='escrow_full_capture'`
- [x] Permit acknowledgement gate
- [x] Redis-backed idempotency (24h TTL)
- [x] Atomic rollback on FK failure (no booking, no audit, slot unchanged)

### Phase 2 — Razorpay (Tasks 10–12)
- [x] `razorpay-client.ts` — createOrder / capturePayment / createRefund with paise conversion
- [x] Error normalisation: `UPSTREAM_5XX`/`RAZORPAY_BAD_REQUEST`/`RAZORPAY_AUTH`/`RAZORPAY_NOT_FOUND`/`RAZORPAY_RATE_LIMITED`/`RAZORPAY_UNKNOWN` with `retryable` flag
- [x] Auth-error messages do NOT echo upstream `description` (key_id leak prevention)
- [x] Test helpers `_resetRazorpayClientForTests` / `_setRazorpayClientForTests` guard against production use
- [x] `verifyWebhookSignature` — HMAC-SHA256 with `crypto.timingSafeEqual`, false on missing header
- [x] Razorpay webhook handler:
  - [x] Redis dedup on event id (14-day TTL)
  - [x] DB unique on `payments.razorpay_payment_id` as structural floor
  - [x] 1000x serial replay produces exactly one payment row
  - [x] Dedup key cleared on DB failure so Razorpay retries can land
  - [x] 500 body does NOT echo `err.message`

### Phase 3 — Wallet + refund flow + cancellation (Tasks 13–15)
- [x] `applyWalletToCheckout` — spend order Outvers credit → Refund balance → Razorpay remainder, with FOR UPDATE on both rows
- [x] `creditRefundBalance` / `creditOutversBalance` — UPSERT + audit row
- [x] `requestCashout` — joins payments⋈bookings with `customerUserId` filter (ownership at library layer); audit written BEFORE Razorpay so a failed audit rolls back without a real-money refund in flight
- [x] `processRefund` — inside-policy auto-credit, no-refund-window rejected row, outside-policy dispute routing, vendor-cancelled 100%
- [x] Snapshot rule respected — uses `booking.cancellationPresetSnapshot`, not live experience preset
- [x] Defense-in-depth ownership guard inside `processRefund` (actor must be customer for self-cancel or experience.vendorUserId for vendor-cancel)
- [x] Outside-policy audit marks commission as `provisionalCommissionOnFeeRupees` + `pendingAdminResolution: true` (M3 Payout reads `dispute.resolved` only)
- [x] `cancelBookingAction` Server Action — better-auth session gate, discriminated result envelope, sanitised user-facing messages (no booking-id leakage)

### Phase 4 — Partial-pay auto-capture (Tasks 16–17)
- [x] Cron route `/api/cron/partial-pay-autocapture` — `CRON_SECRET` via `crypto.timingSafeEqual`
- [x] Selection: state=confirmed, payment_mode=partial_pay, slot.startAt ∈ (now+23.5h, now+24.5h)
- [x] TOCTOU closure: idempotency check, advance-payment lookup, all inside SELECT FOR UPDATE on bookings row
- [x] Razorpay-amount validation: `result.amountPaise === expected` or refuse to commit
- [x] Rounding fix: `autocapture = gross - floor(gross * 0.25)` (no rupee loss on odd-rupee gross)
- [x] Retries on retryable errors with exponential backoff (capped 8s)
- [x] Terminal failure: audit + Pusher event; booking stays `confirmed` (NOT awaiting_completion — would let M3 auto-complete an unpaid booking)
- [x] Migration 0006 partial unique index — cross-container defense

### Phase 5/6 — SEO + Search (Tasks 18, 22)
- [x] Region + Activity registries (controlled vocabulary; 10 each)
- [x] JSON-LD generators: BreadcrumbList, ItemList of Products, FAQPage
- [x] Activity-city loader — slug parser handles multi-token both sides; filters status=published; respects topN
- [x] Activity-city Server Component page emits all three JSON-LD blocks + canonical
- [x] Meilisearch client wrapper with dev-stub fallback
- [x] Experience indexer (`indexExperience` / `deindexExperience`) ready for `after()` hook on publish

---

## Pending — UI verification + live integrations

These items require a running dev server and live test credentials. They do NOT block backend correctness; they DO block the v0.2 user-facing release.

### Task 19 — Experience detail page
- [x] `/{lng}/experience/{slug}` Server Component
- [x] Product + FAQPage + BreadcrumbList JSON-LD (AggregateRating + Review empty in M2 — no reviews yet)
- [x] Slug redirect lookup (Redis 24h cache hitting `slug_redirects`)
- [x] Permit panel with acknowledgement checkbox
- [ ] Verify rich-results in Google Rich Results Test (requires deployed URL)

### Task 20 — Checkout Server Action + Razorpay Checkout.js
- [x] Server Action calls `createBooking(...)` then wallet apply then `createOrder(...)`
- [x] Client `<RazorpayCheckoutButton>` opens the SDK with the order id
- [x] Wallet-covered bookings skip Razorpay order creation (razorpayRemainder=0)
- [x] Payment abandonment audit on modal dismiss
- [ ] End-to-end with live Razorpay test card (requires `RAZORPAY_KEY_ID` + webhook tunnel)

### Task 21 — Booking confirmation page + email
- [x] `/bookings/{id}/confirmation` page (auth-gated, owner-only)
- [x] React Email template (`emails/booking-confirmation.tsx`)
- [x] WhatsApp send-intent audit row (M3 wires the actual MSG91 send)
- [ ] Live email delivery test (requires `RESEND_API_KEY`)

### Task 23 — Faceted search route
- [x] `/{lng}/search` Server Component with Meilisearch faceted query
- [x] Canonical pointing at unfiltered URL for all sort/filter variants
- [x] `noindex, follow` on filtered views; `index, follow` on bare `/search`
- [ ] Live search results (requires provisioned Meilisearch instance)

### Task 24 — E2E happy path
- [x] Playwright spec with browse → detail → JSON-LD verification → search
- [ ] Full Razorpay checkout + webhook + cancel flow (requires staging environment)

---

## How to verify before tagging v0.2-money-path

```bash
pnpm lint && pnpm typecheck && pnpm test
# Expect: 467 tests passing, no warnings.

pnpm test:coverage
# Expect: ≥95% line coverage on lib/payments/* (money-path target), ≥80% overall.
```

Verify the migration set applies cleanly to a fresh Neon dev branch:

```bash
pnpm db:migrate
```

Inspect that the recent commits chain expected by this milestone is in `git log --oneline main`:

```
4cb2d28 feat(search): Meilisearch client + Experience indexer (Task 22, ADR-0013)
f3e9244 feat(seo): activity-city collection page with JSON-LD (Task 18, ADR-0013)
3ddc9be feat(seo): JSON-LD schema generators (BreadcrumbList, ItemList, FAQPage)
8ac9afd feat(seo): region + activity registries (ADR-0013)
91094c0 feat(db): partial unique index for one auto-capture per booking (Task 17)
16584c3 feat(payments): T-24h partial-pay auto-capture cron (ADR-0001)
ca6a120 feat(bookings): cancellation Server Action wired to refund-flow (Task 15)
80b36d8 feat(payments): refund flow with inside/outside-policy branches (ADRs 0003/0004/0005)
4026a2e feat(payments): two-bucket wallet with spend order + cashout (ADR-0004)
b9c2172 fix(webhooks): address Task-12 security review findings (HIGH × 2)
863ccd5 feat(webhooks): idempotent Razorpay webhook handler (ADR-0001)
2dab187 feat(payments): Razorpay webhook HMAC-SHA256 verifier with timingSafeEqual (ADR-0001)
9e55de8 fix(payments): address Task-10 security review findings (CRITICAL + HIGH)
c9366ff feat(payments): Razorpay SDK wrapper with paise conversion + error normalisation (ADR-0001)
```

Tag once the gate above is green:

```bash
git tag -a v0.2-money-path -m "M2 money path complete (Tasks 1–24, 467 tests). Live Razorpay + Meilisearch verification pending staging deploy."
```
