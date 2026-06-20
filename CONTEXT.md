# Outvers

Outvers is an Indian adventure-activity marketplace where **Customers** browse and book **Experiences** offered by independent **Vendors** (rafting operators, paragliding outfits, trekking companies, etc.). This `CONTEXT.md` defines the domain language used across the rebuild at `/outvers-next/`.

## Language

**User**:
The auth-system identity. One human, one credential set. A User holds zero or more marketplace roles — Customer, Vendor, Admin — represented as separate profiles in the schema. See ADR-0006.
_Avoid_: Account, person, member.

**Customer**:
The marketplace role of a User who books Experiences. A User becomes a Customer the first time they create a Booking or Wishlist entry.
_Avoid_: Traveller, buyer, client, guest.

**Admin**:
The marketplace role of a User with platform-administration permissions. Sub-admin is an Admin with a restricted permissions subset, not a distinct role — there's no separate sub-admin entity.
_Avoid_: Operator (overloaded with travel industry meaning), staff, moderator.

**Sub-admin**:
A label for an Admin whose `permissions` set is a strict subset of full Admin powers. Purely a UI / governance term; schema-wise it's just an Admin.
_Avoid_: Treating it as a distinct role or table.

**Vendor**:
The marketplace role of a User who lists one or more Experiences. Carries KYC requirements, a commission rate, a payout destination, and a response-time SLA score.
_Avoid_: Operator, host, supplier, partner, merchant. ("Operator" appears in the global research but Outvers uses "Vendor" consistently — matches the legacy schema and Indian-industry vocabulary.)

**KYC tier**:
The verification stage a Vendor has reached: Phone verified, Identity verified, or Business verified. Determines what the Vendor can list and transact. See ADR-0007.
_Avoid_: Verification level, KYC stage, tier number.

**Identity verified Vendor**:
A KYC-tier-2 Vendor (Aadhaar + PAN). May publish single-day Experiences up to Rs.5,000 per-person and 8 participants per slot. Carries the "Identity verified" badge.
_Avoid_: Tier-2 Vendor (in customer-facing copy), basic-verified.

**Business verified Vendor**:
A KYC-tier-3 Vendor (Tier 2 plus video-call verification, GSTIN-or-self-declaration, and category-relevant guide certs). Unrestricted listing rights. Carries the "Business verified" badge.
_Avoid_: Tier-3 Vendor (in customer-facing copy), fully verified, premium Vendor.

**Response-time SLA score**:
A per-Vendor quality metric tracking how fast they reply to customer enquiries and confirmation requests. Influences search ranking. Orthogonal to KYC tier — a Business-verified Vendor with a poor score ranks below a well-responding Identity-verified Vendor.
_Avoid_: Response time, SLA, reply score.

**Experience**:
A bookable activity offered by a Vendor (e.g. a rafting trip, a paragliding session, a multi-day trek). Includes both single-Experience listings and Combo Experiences.
_Avoid_: Activity, tour, product, listing, package. ("Activity" appears in user-facing URLs as a *category* — `/adventure/{activity}-in-{city}` — but the bookable entity is always an Experience.)

**Combo Experience**:
An Experience whose `is_combo` flag is true, bundling two or more constituent Experiences from the same Vendor into a single discoverable SKU with its own slug, price, and commission rate. Not a runtime cart of Bookings — a single Experience row that intersects constituent availability. See ADR-0008.
_Avoid_: Bundle, package deal, multi-activity.

**Festival tier**:
A time-windowed commission-rate override created by Admin in the `commission_tiers` table, optionally scoped to specific categories / Vendors / Experiences. Fires automatically during the configured window. Highest precedence in the commission resolution chain.
_Avoid_: Promo, sale, seasonal rate.

**Commission snapshot**:
The `(rate, basis)` pair locked onto a Booking row at create time. Subsequent changes to upstream config (Vendor rate, festival tiers) do not affect existing Bookings.
_Avoid_: Live rate, current rate.

**Booking**:
A Customer's confirmed reservation of one Experience for one or more participants on a specific date.
_Avoid_: Reservation, order, purchase, ticket.

**Advance**:
The 25% of a Booking's total value that Outvers captures at booking time under the partial-payment model.
_Avoid_: Deposit, downpayment, hold.

**Partial pay**:
The default payment mode for Bookings ≥48h out and ≤Rs.25,000 — 25% captured as Advance at booking, 75% auto-captured at T-24h. See ADR-0001.
_Avoid_: Split payment, instalment.

**Reserve now, pay later (RNPL)**:
A payment mode where 0% is captured at booking and 100% is auto-captured at a configurable trigger before the Experience. **Named in the schema for v1 but not implemented** — see ADR-0002. Don't use the phrase or the tile badge in v1 marketing copy.
_Avoid_: Pay-on-arrival, hold-and-charge.

**Payout**:
The per-Booking record of money owed to a Vendor for a completed Experience, net of commission, GST on commission, TDS, and GST TCS. One completed Booking produces exactly one Payout. Matures T+7 from Booking Completion (T+30 under the extended window); subject to Dispute pause-and-resume. Carries its own net/TDS/TCS attribution so it feeds the monthly statement and Form 26Q even though many Payouts are paid in a single Payout Batch. See ADR-0016.
_Avoid_: Settlement, disbursement, transfer.

**Payout Batch**:
The unit of money actually sent to Razorpay X: one transfer per `(Vendor, payout destination)` per daily 5pm IST batch, summing every matured Payout that shares that destination. Two Payouts for the same Vendor land in *different* Batches if the Vendor changed their payout destination between the two Bookings (each Booking snapshots its destination at create). A Batch's lifecycle (`processing → paid | failed | reversed`) is driven by Razorpay X payout webhooks and cascades to each member Payout. See ADR-0016.
_Avoid_: Run, settlement file, sweep.

**TDS (Tax Deducted at Source)**:
The 0.1% deduction Outvers must withhold on the gross Booking value paid to resident-Indian Vendors under Section 194-O of the Income Tax Act (rate reduced from 1% to 0.1% by Finance Act 2024, effective 1 Oct 2024). Filed quarterly via Form 26Q; Vendor receives Form 16A. Not optional. See ADR-0016.
_Avoid_: Tax withholding, deduction (ambiguous).

**Extended dispute window**:
A per-category override (T+30 instead of the default T+7) on the Customer's window to raise a Dispute after Booking Completion. Applies to permit-required Bookings and multi-day treks where the Customer may be offline well past trip-end. See ADR-0016.
_Avoid_: Long dispute, late dispute window.

**Commission**:
The percentage of a Booking's gross value that Outvers retains; deducted from the Payout. Realised at Booking Completion, not at payment capture.
_Avoid_: Fee, take rate, margin.

**Wallet**:
The customer-facing surface that displays a Customer's combined balances on Outvers. Backed by two separate buckets (Outvers credit + Refund balance). See ADR-0004.
_Avoid_: Account, balance, credits. ("Account" is the auth abstraction.)

**Outvers credit**:
Closed-loop promotional balance. Funded by referral credit, festive promo credit, loyalty rewards. Spendable only on Outvers Bookings; never cashable. Expires 12–18 months from issue.
_Avoid_: Cashback, points, rewards, gift balance.

**Refund balance**:
A Customer's accrued refunds, defaulting to a Wallet credit (24–48h SLA) but cashable back to the original payment method on request (5–7 working day Razorpay round-trip).
_Avoid_: Cash balance, store credit, refundable balance.

**Completion**:
The event that marks a Booking as delivered. Fires when (a) the Vendor attests via `mark_complete` after `start_at`, or (b) automatically at `end_at + 24h`, whichever first — unless the Customer has raised a Dispute. Completion is the trigger for commission realisation, Payout countdown, review eligibility, and the WhatsApp review prompt. See ADR-0003.
_Avoid_: Closed, finished, settled, delivered.

**Dispute**:
A Customer-initiated claim that a Booking did not deliver as promised (no-show by Vendor, safety incident, partial experience). Raised before Completion is locked in. Routes to support for resolution; outcome is either Completion (possibly with partial refund and commission adjustment) or `cancelled_post_experience`.
_Avoid_: Complaint, ticket, claim. (Support Ticket is a separate entity for general questions.)

**Cancellation policy**:
The rule that determines how much of a Booking is refundable as a function of the cancellation timestamp. Selected per-Experience from three presets — Flexible, Moderate, Strict — or Custom with admin approval. Locked at Booking creation time. See ADR-0005.
_Avoid_: Refund policy, cancellation terms.

**Inside-policy cancellation**:
A Customer cancellation that falls within the time window where a refund is owed by the active Cancellation policy. Refund auto-credits to Refund balance; no human review.
_Avoid_: Free cancellation, eligible cancellation.

**Outside-policy cancellation**:
A Customer cancellation requested *after* the policy window has elapsed. Treated as a Dispute and routed to support; declined by default except in clear vendor-fault cases.
_Avoid_: Late cancellation.

**Vendor-cancelled Booking**:
A Booking the Vendor pulled (weather, equipment failure, under-booking). Always full-refund regardless of Cancellation policy preset; the Vendor's response-time SLA score takes a hit.
_Avoid_: Operator cancellation, supplier cancellation.

**TripGroup**:
A Customer-led entity that convenes 1–12 Customers around a target destination, date window, and budget; owns chat, a collaborative day-by-day itinerary, and a state machine from `forming` to `completed`. The group never books on behalf of members — each member creates their own Bookings with a `trip_group_id` reference. See ADR-0009.
_Avoid_: Trip (which is UI copy, not a schema entity), group booking, party.

**Host (of a TripGroup)**:
The single Customer who convened a TripGroup. Has elevated permissions within the group (approve joins, lock itinerary, archive). Distinct from a Vendor — a Host runs the *group*, a Vendor runs the *Experience*.
_Avoid_: Group admin, organiser, leader.

**Women-only TripGroup**:
A TripGroup with `visibility = public_women_only` — joinable only by Customers whose Aadhaar eKYC verification returned `F` for the gender field. The security floor for women-only is Aadhaar, not self-declaration. See ADR-0009.
_Avoid_: Female-only, ladies-only, all-women.

**AI-assisted surface**:
Any Outvers UI element whose content is partially or fully generated by an LLM (review summaries, vendor listing drafts, inbox reply suggestions, trip planner recommendations). Always labelled to the user; always backed by an `ai_generations` audit row. See ADR-0010.
_Avoid_: AI feature, smart suggestion, automated content.

**Citation trace**:
The set of source-content IDs (review IDs, experience IDs) recorded against an AI-generated bullet or recommendation. Used to verify the AI output is faithful to source data; bullets without verifiable traces are dropped before render.
_Avoid_: Source link, reference.

**Availability slot**:
A concrete reservable timeslot of an Experience — `(experience_id, start_at, end_at, capacity, capacity_taken)`. Materialised by the slot generator from the Experience's pattern + closures. Bookings reference exactly one slot. See ADR-0011.
_Avoid_: Time slot, session, batch.

**Region closure**:
A date range during which a geographic region is closed for adventure activity (monsoon, environmental, safety). Calendar-scoped to the region, not to individual Experiences. Customers see closure status inline on Experience pages within the window.
_Avoid_: Off-season, blackout, downtime.

**Pricing tier**:
A time-windowed override to per-participant Experience pricing — analogous to a Festival tier for commission. Highest precedence in the price resolution chain. See ADR-0011.
_Avoid_: Promo price, sale price.

**Group-size bracket**:
The three mandatory pricing brackets every Experience defines: 1-2 / 3-5 / 6+ participants. The bracket fires based on the Booking's participant count.
_Avoid_: Tier, group rate.

**Required permit**:
A state-issued legal document a Customer must obtain before participating in a permit-gated Experience (ILP, PAP, wildlife area entry). Outvers surfaces the requirement and links to the official process; Outvers does not obtain permits on behalf of Customers in v1.
_Avoid_: License, pass, clearance.

**Canonical locale**:
English (`en`). The fallback for any missing translation. URLs in en have no path prefix (`/adventure/...`); other locales prefix the path (`/hi/adventure/...`). See ADR-0012.
_Avoid_: Default locale (ambiguous), source locale.

**Launch locale**:
A locale where Outvers has populated content sufficient to ship to users at launch. At v1, only `en` and `hi` are launch locales; `ta, mr, bn` are infrastructure-supported but content rolls in across v1.x.
_Avoid_: Supported locale (the infra supports all five), live locale.

**Activity-city collection**:
A landing page at `/{lng?}/adventure/{activity}-in-{city}` combining editorial intro content (MDX) with live product cards (top Experiences in that activity-city). The primary SEO discovery surface — the URL pattern Thrillophilia ranks on. See ADR-0013.
_Avoid_: Listicle (overloaded), category page, landing page.

**Canonical path**:
The single URL that represents an Experience or Vendor for search-engine indexing — `/{lng}/experience/{slug}` for Experiences regardless of which inbound path the user followed. All other paths to the same entity emit `rel="canonical"` pointing here. See ADR-0013.
_Avoid_: Primary URL, main link.

**Slug redirect**:
A retired Experience or Vendor slug retained for 301-redirect handling so old URLs don't break when a slug changes. Retired slugs cannot be reused for 365 days.
_Avoid_: URL alias, old slug.

**Channel manager**:
A third-party booking-and-inventory platform (Bokun, FareHarbor, Rezdy) that a Vendor uses to manage their offerings across multiple sales surfaces. Outvers can connect to a Vendor's channel manager to mirror Experience content and reserve availability — never to ingest Bookings made elsewhere. See ADR-0014.
_Avoid_: Inventory system, partner platform.

**Channel-connected Vendor**:
A Vendor who has authorised Outvers to read from / write to their channel-manager account. Inherits `identity` KYC tier by default; promotion to Business-verified still requires the standard Outvers verification flow.
_Avoid_: Bokun Vendor, third-party Vendor.

**Diverged field**:
An Experience field that a Channel-connected Vendor has manually overridden on Outvers, taking it out of the sync flow. Subsequent channel-manager polls do not overwrite diverged fields.
_Avoid_: Override, custom value.

**Safety stack**:
The set of notification features that fire around an active Booking: trusted-contact requirement, check-in pings at trip start/end, the SOS button, and ephemeral live-location sharing. Triggered only on Experiences flagged `requires_safety_stack`. See ADR-0015.
_Avoid_: Safety features, emergency system. ("Emergency" is misleading — Outvers notifies, doesn't dispatch.)

**Trusted contact**:
A single emergency contact (name, phone, relationship) recorded on a Customer's profile. Mandatory before booking any safety-stack Experience. Receives WhatsApp + SMS notification on SOS trigger; never receives routine pings.
_Avoid_: Emergency contact (semantically suggests Outvers will call them in an emergency, which is wrong — they're notified by us, they decide what to do).

**SOS event**:
A Customer-triggered notification fan-out during an active Booking. Records the trigger, attempts to capture location, sends WhatsApp + SMS to the trusted contact, the Vendor, and Outvers ops. Distinct from a Dispute — SOS is in-trip emergency notification; Dispute is post-trip service complaint.
_Avoid_: Alert, alarm, emergency.

**Check-in ping**:
An automated WhatsApp message at trip start and trip-end + 2h asking the Customer "arrived safely?" / "trip complete?" with quick-reply buttons. No response within 2h escalates to Vendor and ops.
_Avoid_: Status check, wellness check.

## Relationships

- A **User** holds zero or more profiles — **Customer**, **Vendor**, **Admin** — in any combination
- A **Vendor** offers one or more **Experiences** (including **Combo Experiences**)
- An **Experience** belongs to exactly one **Vendor** and has exactly one **Cancellation policy**
- A **Customer** creates one or more **Bookings**
- A **Booking** references exactly one **Experience**, exactly one **Customer**, and exactly one **Availability slot**
- A **Booking** under **Partial pay** produces one **Advance** capture at create and one T-24h capture
- **Completion** of a **Booking** is the trigger for **Commission** realisation, **Payout** start, review eligibility, and the WhatsApp review prompt
- A completed **Booking** produces one **Payout** entry (batched daily) to the **Vendor**, net of **Commission**, GST, and **TDS**
- A **TripGroup** has one **Host** and 1–12 members; each member's individual **Bookings** carry a `trip_group_id` reference — the group itself never books
- A **Required permit** is surfaced to the Customer at Booking time but obtained by the Customer themselves; Outvers does not act as broker in v1

## Example dialogue

> **Dev:** "When a **Customer** cancels a **Booking** at T-3h on a **Flexible** **Cancellation policy** Experience, what gets refunded?"
>
> **Shivam:** "Half. T-3h is past the 50% window for **Flexible** (which goes T-24h free / T-2h half / no refund after). The other 50% goes to the **Vendor** as a cancellation fee, less **Commission**. The refund auto-credits to the Customer's **Refund balance**."
>
> **Dev:** "What if the Booking was a **Combo Experience** with both rafting and paragliding constituents?"
>
> **Shivam:** "Still half. The Combo Experience has its own Cancellation policy preset — it's not a min/max across the constituents. One Booking, one policy, one refund calculation."
>
> **Dev:** "And the **Commission snapshot** locked at create — does the Vendor's cancellation-fee portion still get the snapshot rate?"
>
> **Shivam:** "Yes. Whatever rate was snapshotted when the Customer booked is the rate that applies to the cancellation-fee revenue. Vendor base rate changing later doesn't affect this Booking."

> **Dev:** "A **Channel-connected Vendor** has their Bokun listing show a different price than what's on Outvers. Which wins?"
>
> **Shivam:** "Depends on whether the price field is **diverged**. By default Bokun is source-of-truth — nightly poll overwrites Outvers. But if the Vendor edited it on Outvers, the override sticks until they explicitly re-sync from the diverged-field UI."

> **Dev:** "A Customer on a multi-day trek triggers **SOS** from outside cell coverage; the geolocation call fails. What happens?"
>
> **Shivam:** "The **SOS event** still fans out — to the **Trusted contact**, the **Vendor**, and Outvers ops via WhatsApp + SMS. Location is included if we have it, omitted if not. The notification doesn't depend on geolocation success."

## Flagged ambiguities

- ~~"Trip"~~ — resolved in ADR-0009. TripGroup is the entity; "Trip" is customer-facing UI copy for a single Booking.
- ~~"User" vs "Customer" vs "Vendor"~~ — resolved in ADR-0006. A User can hold any combination of Customer, Vendor, and Admin profiles.
- ~~"Completion" of a Booking~~ — resolved in ADR-0003.
