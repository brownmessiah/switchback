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

## Revision 2026-06-15 — vendor team members in v1 (issue #03)

The original Decision deferred **Vendor team members** to v2 ("One User = one Vendor profile. Add a `vendor_team_members` join table in v2 if multi-seat Vendor accounts are ever needed."). This revision **brings vendor team members into v1**. The original Decision text above stands unchanged for everything else; only the multi-seat deferral is superseded.

### What changes

A Vendor account may now be operated by more than one human, each granted a **scoped role**. The five roles and their permission shapes are encoded in `lib/auth/vendor-permissions.ts` (a pure module) and mirror the sub-admin precedent — a Vendor role is a *permission shape*, not a new top-level role on the User. The roles:

- **Owner** — full access (profile, KYC, bank details, payouts, experiences, bookings, availability, team management). Owner is **implicit**: it is resolved from the `vendor_profiles` row, NEVER stored as a membership row.
- **Manager** — manage experiences, bookings, availability; view analytics. NOT: delete the account, edit bank details, manage team.
- **Booking Staff** — view/manage bookings, scan QR, mark check-in/completed. NOT: pricing, payouts, KYC, team.
- **Guide** — view assigned bookings, mark customers arrived/completed. NOT: earnings, payouts, bank details, KYC, team.
- **Accountant** — view earnings, payouts, invoices, booking revenue. NOT: edit experiences/availability, KYC, team.

### `vendor_team_members` shape

Introduced in migration `0027` (schema: `db/schema/vendor-team-members.ts`):

```
vendor_team_members(
  id              uuid PK default gen_random_uuid(),
  vendor_user_id  text → user.id  (the Vendor account, = vendor_profiles.user_id),
  member_user_id  text → user.id  (the human granted scoped access),
  role            vendor_member_role  ['owner','manager','booking_staff','guide','accountant'],
  status          vendor_member_status ['active','inactive'],
  invited_at      timestamptz,
  last_active_at  timestamptz,
  created_at / updated_at  timestamptz,
  UNIQUE (vendor_user_id, member_user_id)
)
```

`'owner'` exists in the role enum for completeness but is never written as a row — Owner is always resolved from `vendor_profiles`. Issue #04 owns the invite/management actions on this table; issue #03 only adds the table + read-side role resolution. The `status` enum is deliberately minimal (`active`/`inactive`); a pending/`invited` state, if needed, is issue #04's to add.

### Active-role resolution

`resolveVendorRole(db, vendorUserId, actingUserId)` returns the acting user's role on a Vendor account, or `null` (denied):

1. If `actingUserId === vendorUserId` AND an **active** `vendor_profiles` row exists (`closed_at IS NULL`) → `'owner'`.
2. Else look up an **active** `vendor_team_members` row (`vendor_user_id`, `member_user_id = actingUserId`, `status = 'active'`) → its `role`.
3. Else → `null`. An **inactive** member resolves to `null` (denied) — this is the mechanism for Story 36 (Owner deactivates a member without deleting the row).

`requireVendorAccess(db, userId, permission)` (throwing — for layout/page reads) and `hasVendorAccess(db, userId, permission)` (boolean — for Server Actions) compose `resolveVendorRole` with the permission matrix's `can(role, permission)`. For today's single-seat routes the "Vendor account" being accessed is the acting user's own (`vendorUserId === actingUserId`), so everything resolves to Owner = full access → **zero behavior change**.

### Context vs. permission

The URL route group still determines **context** (`app/vendor/...` = Vendor context, per the original Decision). What changes is that Vendor-context Server Actions and reads now **additionally** resolve a member role and authorize against its permission set server-side (Stories 34/35) — a member can never act outside their permissions even by direct URL/POST. This closes the IDOR surface where a `'use server'` action exported a db-injected core taking an arbitrary `vendorUserId`: those cores now live in plain (non-`'use server'`) sibling modules and the thin Server Action wrapper derives identity from the session and gates with `hasVendorAccess`.

### Untouched

This change is scoped to the Vendor role surface. **ADR-0003** (booking state machine), **ADR-0005** (cancellation/refund policy), and **ADR-0011** (availability/pricing/permits) are untouched — no preset, wedge, or schema of those ADRs changes. The admin permission model (`admin_profiles.permissions`, sub-admin as a subset) is also unchanged; the vendor matrix is a parallel, independent permission space.
