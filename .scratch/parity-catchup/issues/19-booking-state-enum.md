# 19: `booking_state` enum — add `no_show` / `pending_payment` / `reserved`

Status: done

> **IMPLEMENTED 2026-06-01 (owner pre-authorised "do the HITL items without my input").**
> ADDED `pending_payment` + `no_show`; did NOT add `reserved` (it's a payment_mode).
> - **Schema + migration:** `booking_state` enum extended; hand-authored `db/migrations/0020_booking_state_pending_payment_no_show.sql` (`ALTER TYPE ADD VALUE IF NOT EXISTS`, harness replays it).
> - **State machine:** new canonical `lib/bookings/state-machine.ts` (transition map + `canTransition` + eligibility predicates), cross-checked against the inline guards. ADR-0003 revised with transitions + money rules.
> - **`no_show` — fully live:** `executeMarkNoShow` (guard: confirmed/awaiting_completion + slot ended; no refund, no SLA penalty, no completedAt ⇒ no payout) + `markNoShowAction` Server Action + vendor "Mark No-Show" button (shown only after slot end). Eligibility reviewed: refund-flow (`confirmed`-only) + payout (`completedAt`-gated) already exclude it correctly.
> - **`pending_payment` — schema + machine + presentation only:** badges (admin/vendor/dashboard) + confirmation presentation ("Payment pending", never the success check) + eligibility (neither payout nor refund). **DEFERRED (needs explicit sign-off):** flipping `createBooking` to write `pending_payment` + webhook→confirmed — it reverses the documented M2 "webhook is record-only" contract; sequenced separately so the shipped money path stays green. See ADR-0003 "Revision 2026-06-01".
> - **Verified:** full vitest 1759/0 (+25), typecheck clean, i18n in sync, eslint clean on changed files.

> **HITL recommendation (agent — owner decides + signs off ADR-0003 before any migration; NOT implemented):**
>
> - **ADD `pending_payment`** — booking is created `pending_payment`, → `confirmed` on the Razorpay webhook capture, → `cancelled_*` on dismissal/timeout. Decouples "booking row exists" from "payment collected". **This is the proper resolution of #15's deferred requirement** (charge before the booking is *confirmed*; today `createBooking` sets `confirmed` at create and #15 only gates the confirmation *page*). Money implications: no payout/refund eligibility while `pending_payment`; an abandoned `pending_payment` booking must auto-cancel + free slot capacity → needs a sweeper/timeout (model on the existing partial-pay auto-capture cron).
> - **ADD `no_show`** — vendor-marked after the slot passes + customer absent. Terminal. Money: vendor retains payment per policy (no refund), affects vendor SLA/payout. Transition: `confirmed`/`awaiting_completion` → `no_show`.
> - **DO NOT add `reserved`** — `reserve_now_pay_later` is a `payment_mode`, not a booking state; an RNPL booking is `confirmed` (or `pending_payment` until the deferred capture). `reserved` would conflate payment-mode with lifecycle state.
>
> **Implementation plan (after owner sign-off):** update ADR-0003 (states + transitions + money) → hand-authored migration (next free number, `ALTER TYPE booking_state ADD VALUE IF NOT EXISTS 'pending_payment'` / `'no_show'`; harness replays it) → state-machine guards + `STATE_PRESENTATION` badges + payout/refund eligibility per state + the `pending_payment`→`confirmed` webhook transition + abandonment sweeper → tests; money-path stays green. **Coupled to #15** (implementing `pending_payment` lets checkout create the booking pending-until-paid).
Type: HITL
Priority: P2
Gap class: feature-gap (schema)
Source: NEXT-INVENTORY data model; seed enrichment couldn't represent these states (REPORT.md P2.3)

## Parent

[Parity audit REPORT.md](../../parity-audit/REPORT.md)

## What to build

`booking_state` currently has: confirmed / awaiting_completion / completed / disputed / cancelled_by_customer / cancelled_by_vendor / cancelled_post_experience. It lacks `no_show`, `pending_payment`, and `reserved` (RNPL). Whether to add them is an **ADR-0003 state-machine decision** with money-path implications (payout/refund handling per new terminal/intermediate states), and requires a **hand-authored numbered migration** (no `drizzle-kit generate`). **HITL**: decide which states the product actually needs and their transitions, then implement.

## Acceptance criteria

- [ ] ADR-0003 updated with the chosen new state(s) + their valid transitions + money implications
- [ ] Hand-authored numbered `.sql` migration adds the enum value(s); test harness replays it
- [ ] State-machine guards + UI status badges (`STATE_PRESENTATION`) handle the new states; payout/refund logic reviewed for each
- [ ] Tests cover the new transitions; existing money-path tests stay green

## Blocked by

None - can start immediately (but requires the human ADR-0003 decision before implementation).
