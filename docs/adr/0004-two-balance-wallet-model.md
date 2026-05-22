# Two-balance wallet model

## Context

The plan uses "wallet" in three contexts — as a refund destination, as the home for referral credit, and as a loyalty mechanism — without defining what a wallet *is*. The choice matters because the legal regime differs sharply: a closed-loop store-credit balance requires no RBI license, while an open-loop withdrawable balance is a Prepaid Payment Instrument requiring full PPI licensing and ongoing compliance. The plan also markets a "24–48h refund SLA" as the biggest competitive wedge against Thrillophilia — the wallet model has to deliver that without creating fintech-grade compliance burden.

## Decision

Every Customer has two distinct balances on their account, presented in one "wallet" UI but tracked separately:

- **Outvers credit** — closed-loop, never cashable, only spendable on Outvers Bookings. Funded by referral credit, festive promo credit, loyalty rewards. Expires 12–18 months from issue. This is promotional expense on the books.
- **Refund balance** — closed-loop by default (Customer can spend it on a future Booking exactly like Outvers credit), but **cashable on Customer request** back to the original payment method via the Razorpay refund API (5–7 working day round-trip). This is a real liability on the books.

The 24–48h SLA refers to the Refund balance increment, not the bank cashout. Marketing copy must say so explicitly: "refund credited to your Outvers wallet within 24h; cashable to your bank in 5–7 working days if you prefer."

When a Customer pays for a Booking, balances apply in this order:

1. Outvers credit (apply first — it expires)
2. Refund balance (apply second — it has cashout optionality)
3. Razorpay charge for the remainder

## Why not the alternatives

- **Closed-loop only** — hides the refund-to-bank option, which first-time bookers and NRIs especially want and trust. The "fast refund" promise is hollow if there's literally no path back to a bank account.
- **Open-loop only** — requires RBI PPI licensing, which is an entire compliance project and out of scope for a 12–18 month solo rebuild. Deferred to a possible v2.x.

## Consequences

- Two balance columns on `users` (or a separate `wallet_balances` table keyed by `(user_id, balance_type)`), not one. Don't "simplify" them to one — the accounting types are different.
- Every wallet movement writes an `audit_logs` row identifying the source bucket, destination bucket, amount, and reason (refund, referral_credit, promo, booking_spend, cashout).
- Cashout requests must verify that the original payment method is still valid (cards expire). If not, fall back to a bank-transfer flow with KYC.
- The Refund balance liability must reconcile against the Outvers working bank account at month-end. Operational dashboard required from M2.
- Customer-facing wallet UI shows one number with a "show breakdown" expand — don't surface the two-bucket distinction except to Customers who actively want it.
