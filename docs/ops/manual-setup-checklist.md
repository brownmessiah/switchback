# Manual setup checklist (operations & compliance)

The business, compliance, and operational tasks **you** need to handle to take Outvers from build to launch — and keep it running. These are the things only a person can do: KYC, government/telecom registrations, financial verifications, and recurring legal/ops duties. Anything technical (servers, code, API wiring) is handled by the tech side and is **not** on this list — see the short FYI at the bottom.

**How to use:** Start every **Phase 0** item *today* — they sit in third-party approval queues that take weeks and will hold up launch if started late. Everything else can be done closer to when it's needed. Tick `- [ ]` → `- [x]` and update the status table as you go.

**Status legend:** ☐ not started · ⏳ in progress / waiting on a third party · ✅ done

**Already in place (no action):** Private Limited company · GST registration · TAN (for TDS) · current bank account.

---

## Status dashboard

| # | Task | Lead time | Cost (approx) | Depends on | Status |
|---|------|-----------|---------------|------------|--------|
| **Phase 0 — start today (long approval queues)** |
| 0.1 | Aadhaar eKYC provider onboarding | **2–4 wks** | ₹0 setup + ~₹2–5/verify | GST ✅, PAN ✅ | ☐ |
| 0.2 | DLT registration (for SMS) | 1–2 wks | ~₹5,900 + renewal | GST ✅, company ✅ | ☐ |
| 0.3 | WhatsApp Business + Meta verification | 1–3 wks | per-message | company ✅, GST ✅ | ☐ |
| 0.4 | Razorpay KYC + Razorpay X (payouts) | 1–2 wks | ₹0 (% per txn) | GST ✅, TAN ✅, bank ✅ | ☐ |
| 0.5 | Bokun partner outreach (channel mgr, M5) | 4–8 wks | ₹0 | — | ☐ |
| **Other one-time** |
| 1.1 | Secure the domain name | mins | ~₹1,000/yr | — | ☐ |

---

## Phase 0 — start today (long approval queues)

These all involve a third party (a KYC provider, the telecom regulator, Meta, Razorpay, or Bokun) reviewing your documents or signing an agreement — which takes weeks. Kick the launch-critical ones (0.1–0.4) off on day 1, in parallel, so they're approved by the time the product needs them; 0.5 (Bokun) is for a later feature but has a long lead too. For each, your job is the **accounts, documents, and approvals**; the tech side wires it into the app once you've cleared it.

### 0.1 — Aadhaar eKYC provider onboarding
- [ ] **eKYC provider onboarded (or interim path confirmed)**

- **Why:** This is what lets vendors verify their identity and reach "Identity verified" status. Until Aadhaar verification *or* the approved interim manual-review path (see Gotcha) is in place, no vendor can publish experiences, accept bookings, or get paid.
- **Where:** Cashfree Secure ID — https://www.cashfree.com/kyc-verification/ · Digio — https://www.digio.in · Signzy — https://www.signzy.com · IDfy — https://www.idfy.com
- **Documents you'll need:** GST certificate, company PAN, certificate of incorporation, authorised-signatory ID, and a rough estimate of how many verifications per month.
- **Time & cost:** 2–4 weeks for approval; roughly ₹0 to set up, then ~₹2–5 per verification (cheaper at volume).
- **What to do:**
  1. First check whether Outvers already has an identity-verification provider from the existing app — reusing that relationship is the fastest path. If starting fresh, **Cashfree Secure ID** (simple, pay-as-you-go), KarzaScore, or IDfy all work.
  2. Sign up and submit the business documents above; request **Aadhaar OTP verification** access. This is the slow part: the aggregator sponsors you onto the government identity system (UIDAI) as a sub-user. (A direct route also exists — under the 2025 Aadhaar "Good Governance" amendment, travel/tourism businesses can apply for their own Aadhaar authentication approval via the tourism ministry/UIDAI — but going through an aggregator is far simpler for a single founder.)
  3. Hand the provider account details to your tech side so they can connect it.
- **Gotcha:** The Aadhaar approval can take the full 2–4 weeks. **Don't let it block launch** — there's an approved interim path (vendor uploads PAN + a selfie + an ID, and you approve manually) that lets vendors get verified while the Aadhaar approval is pending. Those vendors get automatically asked to re-verify via Aadhaar once it's live. The verified badge looks identical either way, so customers never see the difference.

### 0.2 — DLT registration (for SMS)
- [ ] **Company, sender name, and message templates registered on DLT**

- **Why:** Indian regulations require every business sending automated SMS (like login OTPs and booking confirmations) to register on the telecom "DLT" platform first. Without it, no SMS reaches Indian phones.
- **Where:** Guided process via the SMS provider — https://msg91.com/help/dlt-registration-in-india
- **Documents you'll need:** GST, company PAN, certificate of incorporation, authorised-signatory letter, and the exact wording of the messages you'll send (OTP, booking confirmation, etc.).
- **Time & cost:** 1–2 weeks across the approval stages; registration is around ₹5,900 (₹5,000 + 18% GST) on most portals, sometimes with an annual renewal. Sender-name and message-template registration are usually free.
- **What to do:**
  1. Register your **company** on a telecom DLT portal (Jio's is called TrueConnect; Vi's is VILPower — pick one) — you get a registered entity ID.
  2. Register a **sender name / header** (e.g. `OUTVRS`) under the right DLT category — usually **Service Implicit** for login OTPs and booking confirmations (the "Transactional" category is generally reserved for banks). Confirm the category in the MSG91/operator portal.
  3. Register each **message template** and wait for it to be approved.
  4. Pass the approved entity ID, sender name, and template IDs to your tech side.
- **Gotcha:** The message wording must match *exactly* what gets sent — even one changed word causes failures. Register the OTP and booking messages early; adding new message types later means another approval round.

### 0.3 — WhatsApp Business + Meta verification
- [ ] **WhatsApp sender live (+ Meta business verification for higher limits)**

- **Why:** Required for the safety system. An **SOS alert** fans out over WhatsApp to the customer's emergency contact, the vendor, and you (the Outvers ops contact). Separate **trip check-in pings** go to the customer ("arrived safely?"); if they don't reply, that escalates to the vendor and you. Not optional.
- **Where:** Through a WhatsApp provider — MSG91 (https://msg91.com/whatsapp), Interakt, or Gupshup. Underlying account: Meta Business Manager (https://business.facebook.com).
- **Documents you'll need:** A Meta Business Manager account, business verification documents (GST, incorporation), a dedicated phone number that isn't already on regular WhatsApp, and a display name that matches your registered business.
- **Time & cost:** a few days to start sending at low limits; 1–3 weeks for Meta's business verification (the slow part, needed for higher volume). Billed **per delivered template message** — Meta switched from per-conversation to per-message pricing in mid-2025 — with rates depending on message type, country, and your provider's markup. Service replies inside an open 24-hour customer window are free.
- **What to do:**
  1. Set up a WhatsApp Business Account through a provider (MSG91 keeps it together with your SMS) and register + verify the phone number — this alone lets you start sending at low limits.
  2. Submit the message templates (SOS alert, check-in ping) for Meta's approval.
  3. Submit your Meta Business Manager for **business verification** — this raises your sending limits. (The green verified-business badge, an "Official Business Account," is a separate status you request later.) It's the slow step, so start it early, since SOS needs to be reliable at volume.
  4. Hand the account details to your tech side.
- **Gotcha:** Business verification often bounces if the business name or address doesn't exactly match your GST/incorporation documents — make them identical to avoid a restart. You don't need verification to send your first messages, but you do need it before relying on WhatsApp at any real volume.

### 0.4 — Razorpay live account + Razorpay X (vendor payouts)
- [ ] **Razorpay business KYC approved + Razorpay X enabled for payouts**

- **Why:** Razorpay handles all the money. The main account takes customer payments; **Razorpay X** is the separate service that pays each vendor out to their bank account or UPI. Both must be active before vendors can be paid.
- **Where:** https://razorpay.com (dashboard) · Razorpay X: https://razorpay.com/x/
- **Documents you'll need:** company PAN/CIN, GSTIN, TAN, certificate of incorporation, settlement bank account details + a cancelled cheque, signed authorisation, and your business website/app address.
- **Time & cost:** 1–2 weeks. The main KYC is ~2–7 business days, and **Razorpay X adds a separate bank-verification step** (~5–10 business days). ₹0 to activate; standard payment-gateway fees per transaction, plus a small per-payout fee on Razorpay X.
- **What to do:**
  1. Complete **business** (not individual) KYC on the Razorpay dashboard with the documents above. (If Outvers already has a live Razorpay account, just confirm it's active and capture the details.)
  2. Enable **Razorpay X** for vendor payouts — this is a separate KYC/bank-verification layer, so start it as soon as the main account clears.
  3. Ask Razorpay to switch on **Smart Collect** (needed for the part-payment flow) and **international cards** (for overseas/NRI customers).
  4. Hand the account details to your tech side to connect.
- **Gotcha:** Razorpay X is a *separate* approval from the main account, with its own bank-account verification — usually the slow part, so don't leave it till last. Since the RBI's 2025 Payment Aggregator rules, expect stricter document checks during KYC too. Your tech side can build and test against test mode in the meantime, so none of this blocks them.

### 0.5 — Bokun partner outreach (channel manager)
- [ ] **Bokun connectivity agreement + sandbox credentials**

- **Why:** Many Indian adventure operators already manage their listings in Bokun. Connecting to Bokun lets Outvers pull in their inventory faster than signing each vendor up by hand. This only powers a later feature (the M5 channel-manager), but the agreement takes weeks, so start the conversation early.
- **Where:** Bokun Partner / Connectivity team — partner@bokun.io
- **Documents you'll need:** a short description of Outvers as a regional India OTA for adventure activities; nothing heavy.
- **Time & cost:** 4–8 weeks to a signed agreement + sandbox credentials; typically ₹0 (no fee on Bokun's side, but a connectivity/referral agreement is required).
- **What to do:**
  1. Reach out introducing Outvers as a regional India OTA focused on adventure activities; ask about their **read API + inbound webhook program** (not their consumer marketplace).
  2. Get sandbox API credentials issued.
  3. Confirm commercial terms and sign the connectivity/referral agreement.
  4. (Optional) Line up 2–3 existing Outvers vendors already on Bokun as the first pilots.
- **Gotcha:** This blocks only the M5 channel-manager feature, not launch — so it's lower urgency than 0.1–0.4. But the 4–8 week lead time means it's worth opening the conversation now rather than at M5.

---

## Other one-time

### 1.1 — Secure the domain name
- [ ] **Domain registered**
- **Why:** The website address customers use, and what the company email and links are built on.
- **Where:** Any registrar (Cloudflare Registrar is at-cost and recommended).
- **Time & cost:** minutes; ~₹1,000/year.
- **What to do:** Register `outvers.com` (or the chosen name) and hand the login to your tech side to point it at the app.
- **Gotcha:** Lock this in early — the email setup and Google sign-in both depend on owning the domain.

---

## Recurring obligations

These aren't one-time setup — they're ongoing duties that start once you have live vendors and bookings, and they don't stop. Budget real calendar time for them.

| Duty | Cadence | What you actually do |
|------|---------|----------------------|
| **TDS filing (Form 26Q)** | Quarterly | Where Section 194-O applies, a 0.1% tax (cut from 1% in October 2024) is deducted from vendor payouts. (Small resident individual/HUF vendors are exempt if their yearly platform sales stay ≤ ₹5 lakh and they've furnished PAN/Aadhaar.) File the quarterly return on the Income Tax portal and issue each vendor their TDS certificate (Form 16A). |
| **GST returns** | Monthly | Outvers charges 18% GST on its commission. File the monthly GST returns, remit the tax, and issue commission invoices. |
| **GST TCS + GSTR-8** | Monthly | As a marketplace that collects customers' payments on vendors' behalf, you must also collect **0.5% TCS** (GST Section 52) on the net value of vendors' sales and file **GSTR-8** by the 10th of each month. This is separate from the GST on your own commission above. |
| **Approving a new vendor's first 3 payouts** | Per new vendor | For each newly identity-verified vendor, manually approve their first 3 payouts in the admin queue. After that it's automatic. (If you skip this, their payouts stay blocked.) |
| **Business-tier verification calls** | Per applicant | For vendors applying to the top "Business verified" tier, run and record a ~30-minute video call (checking their premises, equipment, and guide certificates) and log it. |
| **24/7 SOS on-call** | Always-on | You are the Outvers emergency contact in version 1. Your phone receives every live SOS WhatsApp alert until a rotating on-call list is set up later. |
| **Reviewing monthly vendor statements** | Monthly (1st) | Statements are generated automatically — review them (gross, commission, commission GST, GST TCS, income-tax TDS, net payout) before they go out to vendors. |
| **Booking reconciliation alerts** | As they come up | If a vendor uses an outside booking tool (Bokun/FareHarbor) and something doesn't sync, you'll get an alert to sort out the discrepancy. |
| **Failed-payout queue** | As they come up | If a payout fails repeatedly, it lands in an admin queue for you to resolve manually. |

---

## Handled by your tech side (FYI — not your tasks)

Listed only so you know they're covered and nothing's been missed. These are software/account setups the tech side owns end to end: app hosting, the database, search, transactional email, analytics, error monitoring, file storage, maps, real-time updates, AI features, Google sign-in, and the technical connection of the Phase-0 services above once you've cleared their accounts and approvals.

---

_Update the status table as you complete items. Questions on any item — ask your tech side; they have the matching technical setup on their end._
