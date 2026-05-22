# Vendor verification tiers

## Context

The plan committed to a "3-tier verification badge (phone/Aadhaar/in-person), PAN + GSTIN + Udyam layered on Aadhaar" without specifying what gates each tier, what a Vendor can do at each tier, or how to handle two structural realities — GSTIN is only legally required above Rs.20L annual turnover (so small Vendors can't get one), and "in-person" verification is impossible to scale for a solo build. The Aadhaar OTP API has a 2–4 week re-application lead time that's already on the critical path.

## Decision

Three tiers with explicit gates, allowances, and badges:

### Tier 1 — Phone verified

- **Gate:** MSG91 OTP confirmed at signup (automatic).
- **Can do:** Create Vendor profile, draft Experiences (saved unpublished).
- **Cannot do:** Publish, accept Bookings, receive Payouts.
- **Badge:** None visible on listings.

### Tier 2 — Identity verified

- **Gate:** Aadhaar OTP via UIDAI eKYC succeeds **AND** PAN submitted and format-validated **AND** at least one Experience submitted for admin review.
- **Can do:** Publish Experiences within Tier-2 caps. Accept Bookings. Receive Payouts (manually approved for first 3, automatic thereafter).
- **Tier-2 caps:** Single-day Experiences only, max Rs.5,000 per-person ticket, max 8 participants per slot. No combo Experiences, no multi-day treks.
- **Badge:** "Identity verified" on Experience cards.

### Tier 3 — Business verified

- **Gate:** Tier 2 first, **plus** all of:
  - Video-call verification (30-min recorded admin call; checklist covers premises, equipment, guide certs).
  - **Either** GSTIN submitted and validated (if declared turnover ≥Rs.20L) **or** signed below-threshold self-declaration plus Udyam Aadhaar registration.
  - At least one ATOAI / RMI / NIM / guide-cert document uploaded for any adventure category that requires it (rafting, trekking, paragliding).
- **Can do:** Unrestricted listing — multi-day Experiences, combos, any ticket size, any participant count. Automatic Payouts on T+7. Eligible for top-operator ranking signals and editorial featuring.
- **Badge:** "Business verified" on Experience cards; tooltip shows which categories of certs were submitted (not the documents themselves).

### Operational decisions

- **"In-person" is reframed as video-call verification** for v1. Same trust signal, achievable solo. A true literal-in-person tier is deferred to v2 (with an ops team); video-verified Vendors are not downgraded when that lands.
- **Aadhaar API fallback:** if the OTP API isn't approved by M3, Tier 2 temporarily becomes PAN + selfie + ID upload + admin manual review. Vendors who onboard via the interim path are auto-prompted to re-verify via Aadhaar OTP once the API lands. Badge text is identical either way — operational state doesn't leak to the trust signal.
- **Response-time SLA score is orthogonal to tier.** A Tier-3 Vendor with poor SLA gets ranked lower but doesn't lose their tier. A Tier-2 Vendor with excellent SLA still hits the caps. Verification and quality are independent dimensions.

## Why not the alternatives

- **Blanket gate — "no publishing until full verification"** — Tier 3 takes weeks (video call scheduling, document review). A no-publishing rule is hostile to new supply, which is the marketplace's lifeblood and the differentiator vs Thrillophilia's gated partner program.
- **Mandatory GSTIN at any tier** — illegally over-restrictive (Rs.20L threshold is national law) and locks out the long-tail of small operators who are the Indian-moat differentiator.

## Consequences

- `vendor_profiles.kyc_tier` is an enum (`phone | identity | business`). State transitions write audit-log rows with the gating-evidence (Aadhaar response, video-call recording ID, document IDs).
- The Tier-2 caps are enforced at Experience-publish time and at Booking-create time (double-checked because the cap could change due to a Tier downgrade after an Experience was published).
- A Vendor's first 3 Payouts after reaching Tier 2 are queued for manual admin approval. The approval queue is a hard M2/M3 deliverable, not just a flag — without an admin UI for it, Payouts get blocked.
- Aadhaar API re-application starts day 1 of M1, in parallel with code (per the plan's "operational kickoff in parallel" note). If the API isn't ready by mid-M3, default to the fallback path and ship — don't slip M3 waiting on UIDAI.
- The "Business verified" tooltip needs a per-category cert-requirement registry (rafting → ATOAI / Class IV+ guide cert; trekking → RMI / NIM / ABVIMAS; paragliding → APPI). Maintain in `lib/kyc/cert-requirements.ts`.
