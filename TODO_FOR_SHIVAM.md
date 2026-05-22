# TODO for Shivam — Operational kick-off list

These items have **multi-week external lead times** and cannot be parallelised by code work. Starting them now means M1–M3 ship on schedule; delaying them pushes the launch out by the same number of weeks.

Each section is independently actionable. Tick the box, drop a note with the date you started, and capture the account / reference number where applicable so the implementation work can wire it up later.

---

## 1. Aadhaar OTP API re-application (UIDAI)

- [ ] Start UIDAI eKYC API re-application via the existing AUA / KUA route used by the legacy app, OR fresh application via a sub-AUA (Cashfree Verify Suite, KarzaScore, IDfy) if the legacy AUA relationship is no longer usable
- [ ] Confirm which AUA the current Outvers app uses (`/Users/aishwaryechauhan/Personal/travel-app/convex/aadhaarKyc.ts` likely names them)
- [ ] If routing via a sub-AUA, get a sandbox key issued (typically same day) and production access (2–4 weeks)

**Lead time:** 2–4 weeks (UIDAI), often 6+ weeks if going direct.
**Blocks:**
- ADR-0007 Tier 2 — "Identity verified" Vendor verification flow (M3).
- ADR-0009 — Women-only TripGroups eligibility check (uses Aadhaar gender field).

**Fallback (per ADR-0007):** Tier 2 temporarily becomes PAN + selfie + ID upload + admin manual review. M3 ships on schedule with the fallback; the API plumbing slots in when the production key lands.

---

## 2. MSG91 WhatsApp Business template approvals (Meta)

Each template needs Meta approval per language. Allow 24–72 hours per template per language. Submit **all en + hi versions in week 1 of M1** so they're ready when M3 wires the transactional flow.

- [ ] MSG91 account active, WhatsApp Business API number registered, sender display name approved
- [ ] Submit en templates (Meta WABA console via MSG91):
  - [ ] `booking_confirmation` — confirms Booking with Experience name, slot, participants, gross, Cancellation policy line
  - [ ] `t_minus_24h_reminder` — pre-trip reminder + Vendor WhatsApp deep-link + partial-pay second-capture notice (ADR-0001)
  - [ ] `t_minus_2h_ping` — "you're on" message with slot start + map link
  - [ ] `post_trip_review_prompt` — fires on Completion (ADR-0003); includes photo upload CTA
  - [ ] `t_minus_7d_permit_reminder` — fires only for Experiences with `required_permits` (ADR-0011)
  - [ ] `sos_notification` — to trusted contact + Vendor + Outvers ops (ADR-0015)
  - [ ] `check_in_ping_start` and `check_in_ping_end` — safety-stack quick-reply pings (ADR-0015)
  - [ ] `refund_credited` — fires on inside-policy cancellation credit (ADR-0004, ADR-0005)
  - [ ] `payout_issued` — Vendor-facing payout confirmation (ADR-0016)
- [ ] Submit hi versions of every template above (per ADR-0012, en + hi are the v1 launch locales)
- [ ] `ta`, `mr`, `bn` queued behind launch — submit when content curation catches up; not a launch blocker

**Lead time:** 24–72hr per template per language, plus rework for any Meta rejection (typically 1–2 rounds per template).
**Blocks:** M3 (WhatsApp transactional flow) cannot ship before templates approve.

---

## 3. Bokun partner outreach (channel-manager connector — ADR-0014)

- [ ] Identify the right contact at Bokun (their Partner / Connectivity team — partner@bokun.io)
- [ ] Initial outreach explaining Outvers as a regional OTA in India targeting adventure activities, asking about their **read API + inbound webhook program** (not their consumer marketplace)
- [ ] Get sandbox API credentials issued
- [ ] Confirm commercial terms — usually no fee on Bokun side, but a referral / connectivity agreement is required
- [ ] (Optional) Identify 2–3 existing Outvers Vendors who already use Bokun, line them up as the first connector pilots

**Lead time:** 4–8 weeks to a signed agreement + sandbox credentials.
**Blocks:** M5 (Bokun connector ships). FareHarbor connector is v1.x — not a launch blocker.

---

## 4. Razorpay live activation + Razorpay X

- [ ] Razorpay live account already active under Outvers Pvt Ltd? If yes, capture KEY_ID + SECRET (we'll use test keys until M2 anyway)
- [ ] If not active: complete the full Razorpay KYC (CIN, GSTIN, TAN, signed authorisation, settlement bank account) — typically 2–7 business days after document submission
- [ ] Enable **Razorpay X** for Vendor Payouts (ADR-0016) — separate KYC layer; bank-account verification typically adds 5–10 business days
- [ ] Enable webhook on `payment.captured` and `payment.failed`; webhook secret in env (`RAZORPAY_WEBHOOK_SECRET`)
- [ ] Confirm **Smart Collect** is enabled for partial-pay second-capture flow (ADR-0001)
- [ ] Confirm **international cards** are enabled (foreign-card customers — NRIs, inbound tourists)

**Lead time:** 1–2 weeks.
**Blocks:** M2 (money path). Test-mode is fine through most of M2; live activation must complete before M3 verification gates.

---

## 5. Tax registration sanity check (ADR-0016)

- [ ] **GSTIN active** for Outvers Pvt Ltd? Confirm at https://services.gst.gov.in/services/searchtp — input PAN, verify current status
- [ ] **TAN active** for TDS deduction? Confirm at https://incometaxindia.gov.in (TAN search) — TDS under Section 194-O is a hard legal obligation
- [ ] Confirm with CA: are the quarterly Form 26Q filings on a regular schedule already? If not, agree filing windows now (M4 will surface a generator at `lib/tax/tds-returns.ts` per ADR-0016)
- [ ] Confirm: 18% IGST applies to commission revenue regardless of Vendor GSTIN status — the existing tax stack handles this?

**Lead time:** Same-day to verify. Renewal/registration where missing: 1–4 weeks.
**Blocks:** M2 money path cannot capture live payments without GSTIN. Quarterly TDS filings begin once Bookings go live in M2/M3.

---

## 6. SaaS account creation list

These are quick (most are sign-up-and-go) but every one of them needs a payment method and a couple of clicks. Doing them in one sitting in M1 week 1 means M1 doesn't stall on missing credentials.

- [ ] **Vercel Pro** — `shivamchauhan@gmail.com` as owner; team plan for the `outvers-next` project; enable Vercel Analytics
- [ ] **Neon** — create a project in **`ap-south-1` (Mumbai)**; create a `production` branch and a `develop` branch; capture the pooled + direct connection strings
- [ ] **Cloudflare R2** — create a bucket `outvers-uploads-prod` (region: Asia-Pacific); generate an API token with R2 read/write scope; note the `accountId`
- [ ] **Upstash Redis** — create a database in `ap-south-1` (Mumbai); capture REST URL + token
- [ ] **Sentry** — create project `outvers-next` (Next.js platform); capture DSN; create a separate project for staging vs prod
- [ ] **PostHog** — create a project (region: India / EU if available); capture project API key
- [ ] **Resend** — verify the sending domain (likely `outvers.in` or whatever the production domain ends up being); add SPF + DKIM records to Cloudflare DNS
- [ ] **Mapbox** — create a token scoped to the production domain
- [ ] **OpenAI** — verify the existing API key is live; create a separate key per environment (dev / prod) so we can rotate without downtime
- [ ] **Pusher** — create an app in `ap-southeast-1` (closest region to Mumbai); capture appId, key, secret, cluster
- [ ] **Meilisearch Cloud** — provision a `Build` tier instance (Mumbai if available, else Singapore); capture host + master key
- [ ] **GitHub** — create the `outvers/outvers-next` repo (private); add Shivam + Claude Code as collaborators if working from multiple machines

**Lead time:** ~2–3 hours total if done in one sitting.
**Blocks:** Various M1 steps stall without the credentials. Best to bulk-create.

---

## 7. Confirm open items in PLAN.md handoff notes

PLAN.md flags four open items. Three are confirmed by the operating defaults below; one needs a real decision.

- [x] **Folder name** — `outvers-next/` is committed (this directory)
- [ ] **Domain** — keep `outvers.onhercules.app` during M1–M5 development; cut over to a custom domain (`outvers.in` recommended) at the M6 launch window. Confirm the custom-domain registrar + plan to flip Cloudflare DNS at cutover.
- [ ] **Team size + start date** — solo build with Claude as the engineer. v1 launch realistically 12–18 months from M1 start. Confirm: are you OK with that runway, or do you want to drop scope (Content/community or Channel ingestion) to compress to 6 months?
- [ ] **Bokun outreach owner** — Shivam. (Per item #3 above.)

---

## How to use this file

- Tick boxes as items complete
- For each external dependency, capture the issued credentials / reference number / contact in a private notes app or 1Password vault — do NOT commit secrets to this repo
- When the Aadhaar API key lands, MSG91 templates approve, or Bokun signs, drop a one-line note in the relevant section so future-me / future-Claude can see the progression
- Re-read this file at the start of M3 (KYC + WhatsApp work) and M5 (Bokun connector) — most items should be green by then
