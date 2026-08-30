# Channel manager ingestion (Bokun, FareHarbor)

## Context

The plan committed to "Bokun + FareHarbor inbound connectors (poll + webhook)" because the research showed Klook and Viator use channel-manager integrations to onboard supply faster than direct Vendor signup, and Indian adventure operators are already on Bokun/Rezdy. The plan didn't specify what "ingestion" means concretely — and the wrong choice turns Switchback into a meta-marketplace mirroring third-party Bookings with no authority over them. Six concrete decisions had to be made together: connection model, KYC handling, source-of-truth split, commission stacking, reconciliation, and whether inbound Bookings ingest at all.

## Decision

### Connection model

Vendor connects their channel-manager account at Switchback onboarding via OAuth (where available) or API-key. Credentials stored encrypted in `vendor_channel_connections(vendor_user_id, channel, credentials_encrypted, connected_at, last_sync_at, status)`. Connection is per-Vendor; one Vendor may connect at most one channel manager.

### KYC mapping

Channel-connected Vendors map to Switchback `kyc_tier = identity` and inherit Tier-2 caps (single-day, Rs.5K, 8 participants per ADR-0007). To reach Business-verified, the Vendor still completes the video-call + GSTIN/Udyam flow on Switchback. A separate "Verified on Bokun" badge surfaces alongside the KYC tier badge.

### Source-of-truth split

| Domain | Source of truth | Sync direction |
|---|---|---|
| Experience content | Channel-manager, with Vendor-overridable `diverged` flag | Inbound on webhook + nightly poll; diverged fields are not overwritten |
| Availability | Channel-manager (authoritative) | Switchback calls CM API at Booking-create to reserve; failure rejects Booking |
| Bookings | Switchback (for Switchback-originated) | Outbound — push seat-blocked on success, push release on cancel |
| Refunds | Switchback | Outbound — CM notified to release the seat |
| Commission | Switchback (independent of CM fee) | None |

### Commission stacking

Switchback charges its standard commission per ADR-0008. Bokun separately charges the Vendor a Bokun fee. Switchback does not pay Bokun's fee on the Vendor's behalf. Vendor dashboard surfaces "net to you after Switchback commission" with a callout that the CM fee comes out separately.

### Reconciliation

Nightly job compares `(channel_booking_ref, outvers_booking_id)` across the two systems. Discrepancies raise admin alerts in an M3-built reconciliation queue. Common case (cancellation didn't propagate due to CM outage) auto-retries with exponential backoff up to 24h before escalating.

### Inbound Booking ingestion is out of scope for v1

Switchback does not display Bookings made via other channels. The Vendor sees those in their own CM dashboard. v1.x may ship an analytics-only mirror (aggregate slot-utilisation, no Customer PII) but not a Customer-facing Booking surface.

### Rollout

Bokun connector at v1 (M5). FareHarbor in v1.x.

## Why not the alternatives

- **Switchback as source of truth for availability** — defeats the connector's purpose; Vendors won't double-maintain their calendar.
- **Granting Business-verified status on Bokun connection alone** — Bokun's vetting is not Switchback' vetting; cap-bypass is a quality-control failure waiting to happen.
- **Unified Switchback + Bokun commission negotiation** — operationally complex, not a v1 lever. Vendors take both fees independently.
- **Full inbound Booking mirroring** — turns Switchback into a meta-marketplace over Customer records it doesn't own; PII, KYC, and dispute mechanics all misalign.

## Consequences

- The `vendor_channel_connections` credential encryption must use a key managed in Vercel env / a KMS, not a static `.env` value — connector credentials are long-lived and high-value.
- Webhook endpoints `app/api/webhooks/bokun/` and (later) `app/api/webhooks/fareharbor/` must validate signatures with the CM's webhook secret; idempotency-key dedup via Upstash Redis (same pattern as Razorpay).
- Booking-create must call the CM availability API inside the transaction with a tight timeout (2-3s). Slow CM responses must not block the Booking flow indefinitely — set an SLO and degrade to "manual hold" with admin alert if exceeded.
- The reconciliation queue UI is an M3 deliverable, not M5 — connector goes live in M5 but the discrepancy-handling needs to exist before the first connection is established.
- The `diverged` flag pattern needs UI affordances in the Vendor dashboard ("This field differs from your Bokun listing. Sync to match? / Keep override?") so Vendors understand what's happening at sync time.
