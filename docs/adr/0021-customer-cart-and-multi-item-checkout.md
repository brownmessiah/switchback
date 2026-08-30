# Customer cart and multi-item checkout

Amends ADR-0008 (which rejected "Combo as a runtime cart"). Builds on ADR-0001 (partial-pay capture), ADR-0004 (two-balance wallet), ADR-0007 (KYC tier caps), ADR-0016 (payouts/GST/TDS).

## Context

CR4 of the homepage redesign adds a customer **Cart**. None exists today: booking is single-Experience and direct-to-checkout. ADR-0008 rejected "Combo as a runtime cart of multiple Experiences" — but that ruling was about representing a *Combo product* as a basket (which would kill the combo SEO URL, force N-way inventory intersection, N commission rows, and per-constituent cancellation ambiguity). A customer **checkout cart** is a different concept, and this ADR introduces it and records how it maps onto the money path.

Money-path facts this decision must respect (all verified in code):

- `createBooking(db: DBOrTx, input)` (`lib/payments/booking-create.ts`) is the load-bearing per-booking primitive. It opens its own `db.transaction`, resolves pricing/commission/GST/TCS/TDS, re-checks the KYC tier cap (ADR-0007), decrements slot capacity under `SELECT … FOR UPDATE`, writes the `bookings` row with **12 immutable snapshot columns** (enforced by trigger `bookings_snapshot_lock`), and writes an audit row — all atomically. Passing an outer `tx` nests it as a **savepoint**, so N calls can run under one outer transaction.
- **Payment is strictly 1:1 with a booking today**, enforced at three layers: `payments.booking_id` NOT NULL single FK; `payments.razorpay_order_id` partial-unique; the webhook reads a single `notes.booking_id`.
- Partial-pay + T-24h auto-capture (ADR-0001) and payout batching (ADR-0016) are **per booking**. The **194-O ₹5L TDS threshold** is FY-cumulative **per vendor** (ADR-0016) — the only tax that spans bookings. GST-on-commission (18%) and TCS §52 (0.5%) are pure per-booking.

## Decision

### The cart is a saved list; checkout creates N independent Bookings

A cart holds M line items (`experience_id` + `slot_id` + `participant_count`). It is **not** a product and never becomes a Combo (contrast ADR-0008). At checkout each line item becomes its **own independent Booking** via the existing `createBooking` primitive — its own commission/cancellation/tax snapshots, its own state machine, its own payout. The cart is a thin orchestration layer over N `createBooking` calls, not a new money engine.

### Schema: a checkout `orders` envelope; Bookings and the payment link to it (additive only)

No existing single-item constraint is relaxed:

- New `orders` table (checkout session/envelope): `id`, `customer_user_id`, `razorpay_order_id` (unique), `amount_total_snapshot numeric(14,2)`, `state`, timestamps.
- `bookings.order_id uuid` nullable FK → `orders.id`. Single-item "Book now" bookings leave it `null` (mirrors the existing nullable `trip_group_id` grouping); cart bookings link to their order.
- `payments.order_id uuid` nullable FK; `payments.booking_id` becomes **nullable**; add CHECK `payment_scope_exactly_one` — exactly one of `booking_id` / `order_id` is non-null. A payment is **either** booking-scoped (legacy single-item path, untouched) **or** order-scoped (cart). `razorpay_payment_id` and `razorpay_order_id` uniqueness are preserved (one order → one payment).

### One transaction, one Razorpay payment, all-or-nothing

Cart checkout runs the N `createBooking` calls under **one outer `db.transaction`** (each nesting as a savepoint), creates the `orders` row, and creates **one** Razorpay order for the cart total (after wallet), carrying `notes.order_id`. The webhook records **one** order-scoped payment row. If any line item fails (`TIER_CAP_EXCEEDED`, sold out, capacity), the whole outer transaction rolls back — cart checkout is atomic; a rejection audit row is written on the top-level handle identifying the failing item.

### v1 cart checkout is full-upfront; partial-pay in a cart is deferred

The genuine complexity is partial-pay *across different dates within one cart*: each booking's 75% balance auto-captures at its own T-24h, which does not compose cleanly with a single shared order payment. **v1: every line item in a cart checkout is coerced to `full_upfront`.** Single-item "Book now" retains full partial-pay support, unchanged. This keeps cart checkout to one immediate capture over N bookings. Partial-pay for carts is a documented v2 follow-up.

### Deterministic ordering for the 194-O threshold

Because the N `createBooking` calls run sequentially in one uncommitted transaction, each call's FY-gross aggregation SELECT sees the earlier same-cart bookings for the same vendor, so the ₹5L 194-O threshold accumulates correctly across cart items. To make the crossing point stable and reproducible, cart line items are processed in a **deterministic order** (by `created_at`, then `cart_item_id`). All other tax and the ₹25,000 escrow / 48h coercion are pure per-booking and unaffected.

### Wallet applies once, at order level, attributable per booking

Wallet (ADR-0004: Switchback credit → Refund balance → Razorpay remainder) is applied once against the cart total in the mandated order; the spend is allocated back to individual bookings for audit/reconciliation, because the Refund-balance liability must stay per-booking attributable.

## Why not the alternatives

- **N Razorpay orders (one per booking) in one checkout** — Razorpay standard checkout is one order per modal; N orders means N payment modals or a broken UX. Rejected for the "pay once" goal.
- **One captured payment fanned into N `payments` rows sharing a `razorpay_payment_id`** — violates the `razorpay_payment_id` UNIQUE constraint and forces hacks (suffixed ids) that pollute the load-bearing money table. Rejected in favour of an order-scoped payment.
- **Relax `payments.booking_id` into a many-to-many payment↔booking allocation table** — heavier surgery on the most security-sensitive table for no v1 benefit; the XOR (booking-scoped | order-scoped) payment covers both flows with one nullable column + a CHECK.
- **Represent the cart as a Combo/bundle SKU** — exactly what ADR-0008 rejected, and wrong here: cart items are unrelated Experiences the customer chose, need no combo URL, and are correctly N independent Bookings.
- **Allow partial-pay across a multi-date cart in v1** — per-booking T-24h auto-capture against a shared order payment is genuinely complex and high-risk on the money path; deferred rather than rushed.

## Consequences

- **Amends ADR-0008.** 0008's rejection of "Combo as a runtime cart" stands for *Combo products*; the customer *checkout cart* here is a distinct, permitted concept that produces N independent Bookings (never a Combo). A cross-reference note is added to 0008.
- Migration is a hand-authored numbered `.sql` (drizzle journal is stale; harness replays `.sql`): `orders` table + `bookings.order_id` + `payments.order_id` + `payments.booking_id` nullable + the `payment_scope_exactly_one` CHECK. The single-item flow is untouched (still writes booking-scoped payments).
- Webhook gains an order path: `extractOrderId(notes)` alongside `extractBookingId`; `persistPaymentCaptured` writes an order-scoped payment; Redis event-dedup and `razorpay_payment_id` unique idempotency still apply; signature verify unchanged.
- **Idempotency (load-bearing for issue 12):** cart checkout needs one idempotency key at the action level; the per-item `createBooking` Redis keys must be derived deterministically (e.g. `${cartCheckoutKey}:${cartItemId}`) and set after the outer commit, so a retried cart checkout cannot double-create a subset of bookings.
- Payout (ADR-0016) is unchanged — it reads per-booking snapshots + completion, so an order-scoped customer payment does not affect per-vendor payout batching.
- Every money mutation still writes an in-transaction audit row (`order.create`, per-booking `booking.create`, order-scoped `webhook.payment.captured`, per-booking `wallet.apply_to_checkout`).
- Money-path tests (mandatory before issue 12 ships): all-or-nothing rollback when one item fails; per-booking snapshots correct across N items; the 194-O threshold flips correctly mid-cart for a same-vendor individual/HUF crossing ₹5L; exactly one order-scoped payment recorded; webhook idempotent against replay; wallet applied once in ADR-0004 order and attributable per booking.
