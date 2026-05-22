# User role model and multi-role support

## Context

The plan declares "Multi-role (customer/vendor/admin/sub_admin)" without specifying the schema. The legacy Convex app has a `users.ts` plus a separate `subAdmin.ts`, suggesting an ad-hoc split. better-auth (the chosen auth layer) owns its own `user` table for credentials and sessions; the question is how marketplace domain data attaches to it. Three candidate models existed: single wide table with a `role` enum, single table with a `roles` array, or separate per-role profile tables. The choice is foundational — it's the very first schema file written in M1 and every other domain table references it.

## Decision

**Auth users + per-role profile tables.** better-auth owns the `users` table (identity + sessions). Marketplace roles attach via three separate profile tables, each FK-linked to `users.id`:

- `customer_profiles(user_id, wishlist, default_address, preferred_language, ...)`
- `vendor_profiles(user_id, business_name, slug, kyc_status, kyc_tier, gstin, pan, udyam_id, commission_rate, payout_method, response_time_sla_score, ...)`
- `admin_profiles(user_id, permissions[], invited_by_user_id, ...)`

A User can hold any combination of profiles. Sub-admin is **not a separate role** — it's an Admin whose `permissions` array is a strict subset of full-admin powers. There is no `sub_admin_profiles` table, no `sub_admin` enum value. Treating sub-admin as a permission shape rather than a role makes "promote a sub-admin to full admin" a permissions diff, not a row migration.

The current role context of a session is determined by URL route group:

- `app/(app)/...` — Customer context
- `app/(vendor)/...` — Vendor context
- `app/(admin)/...` — Admin context

The session token does *not* carry the active role — purely URL-driven for v1. Revisit if API-level role enforcement is ever needed.

**Wallet attaches to User**, not to a profile. A User who is both Customer and Vendor sees one Wallet (their customer-side balance). Their Vendor payouts land in `vendor_profiles.payout_destination` (a business bank account), which is a different concept and never mixes.

**Vendor team members** (multiple humans on one Vendor) — **out of scope for v1**. One User = one Vendor profile. Add a `vendor_team_members` join table in v2 if multi-seat Vendor accounts are ever needed.

## Why not the alternatives

- **Single `users` table with a `role` enum** — wide schema, every role-specific column nullable for the others, blocks multi-role (one human Vendor who also books trips). Loses the "every Vendor has a KYC status" invariant at the type level.
- **Single `users` table with `roles` array** — better than enum but still mixes domain data into the auth identity. Eventually grows related tables (`vendor_kyc_documents`, `vendor_payouts`) — cleaner to start with profile separation.

## Consequences

- The first M1 schema is the auth `users` table (via better-auth's Drizzle adapter) followed immediately by the three profile tables. Build a `getCurrentUser(req)` helper that returns `{ user, customerProfile?, vendorProfile?, adminProfile? }` so route handlers can rely on type-narrowed access.
- `users` table must be lean — anything role-specific belongs in a profile table. Resist the temptation to drop "obviously general" fields like `default_address` onto `users` (it's customer-specific — Vendors have a business address, Admins have neither).
- Conflict-of-interest cases (Admin who is also a Vendor) are not blocked at the schema level — to be enforced (if at all) in policy rather than schema. Note as an open governance question for post-launch.
- Sub-admin invitation flow creates an `admin_profiles` row with a restricted `permissions` array. The audit log entry is the same shape as creating a full admin (only the permission set differs) — simplifies admin UI.
