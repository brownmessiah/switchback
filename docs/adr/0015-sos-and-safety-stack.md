# SOS and safety stack

## Context

The plan committed to "SOS button (one-tap shares live location with platform + designated contact), check-in pings at trip start/end" and named it as a differentiator vs MakeMyTrip and Thrillophilia. It didn't address what SOS actually does, what trusted-contact data looks like, how check-in pings work, the geolocation permission flow, or — critically — the legal posture (positioning Outvers as a safety *service* implies liability when it fails; positioning it as a notification *feature* with clear disclaimers does not).

## Decision

### Posture — notification, not response

Outvers SOS is a notification tool. It does not dispatch emergency services and does not promise response. The legal disclaimer at Booking confirmation states explicitly: "Outvers SOS is a notification tool, not an emergency response service. In life-threatening emergencies dial 112."

### SOS event fan-out

On SOS trigger during an active Booking, Outvers:

1. Writes an `sos_events` row (timestamp, Customer, Booking, location attempt).
2. Captures browser geolocation (permission-requested at trigger if not already granted).
3. Sends WhatsApp + SMS to the Customer's trusted contact.
4. Sends WhatsApp to the Booking's Vendor.
5. Sends WhatsApp to a 24/7 Outvers ops contact (v1: Shivam's number; v1.x: rotating list).

### Trusted contact

`customer_profiles.trusted_contact_{name, phone, relationship}`. Mandatory before booking any Experience with `requires_safety_stack = true`:

- All treks, all paragliding, scuba, bungee, white-water rafting.
- Any Experience in a region with active permits.
- Any Experience in a region with `region_safety_flag = high`.
- Any Experience the Vendor manually flagged.

### Check-in pings

- Trip-start (slot `start_at` ± 30 min): WhatsApp "arrived safely?" with quick-reply yes/no.
- Trip-end (slot `end_at + 2h`): similar.
- No response → automated alert to Vendor and Outvers ops.
- Customer can disable per-Booking with confirmation modal noting loss of auto-notification fallback.

### Live location

Browser geolocation API; Customer opts in at Booking confirmation. Sampled every 5 minutes during the trip window (`start_at` to `end_at + 24h`). Stored in `location_snapshots`, auto-deleted T+72h after trip end. Visible to Customer routinely; to trusted contact and Vendor only at SOS trigger; never on routine basis. Mobile-web only at v1.

### Vendor and Admin surfaces

- Vendor dashboard: active SOS events for own Bookings only.
- Admin dashboard: all active SOS events platform-wide with resolution workflow.

### Out of scope for v1

- Phone-call integration (Twilio voice).
- Integration with 112 / state emergency services.
- Smartwatch / Garmin SOS device integration.
- Continuous live-location streaming to trusted contacts (privacy concerns).

## Why this posture

- Positioning as an emergency *service* creates a duty of care Outvers cannot solo-staff to provide. The right framing is "we'll make sure people know" — which is achievable and honest.
- The 24/7 ops alert routes to a real human (Shivam at v1) because alerts without a recipient are theatre. Document the ops escalation playbook before SOS goes live.
- Auto-delete of location snapshots after T+72h is a privacy default that pre-empts requests to delete; surveillance logs aren't a feature.

## Consequences

- The SOS button is *only* visible in the Customer UI when there's an active Booking (state `confirmed`, `start_at ≤ now ≤ end_at + 24h`). Don't show it routinely — it loses meaning.
- `location_snapshots` auto-purge job runs daily; failure to purge is a privacy incident, not a degraded feature. Alert at 12h-overdue.
- MSG91 template for SOS messages needs Meta approval as a transactional template; submit in week 1 of M1 alongside the standard booking-flow templates.
- The trusted-contact flow requires Customer education — most Indian customers won't have set one before they try to book a trek. The Booking flow must catch this earlier (at slot-selection, not at payment) to avoid checkout abandonment.
- `region_safety_flag` lives in the region registry (per ADR-0011). High-flag regions are admin-curated; not every region needs the safety stack.
- An SOS triggered against a Booking that is not currently active (out of window) is rejected with a friendly error directing the Customer to 112.
