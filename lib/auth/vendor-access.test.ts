import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { hasVendorAccess, requireVendorAccess, resolveVendorRole } from './permissions'

/**
 * Integration tests (PGlite) for the DB-backed Vendor access gate
 * (ADR-0006 rev 2026-06-15, issue #03). Proves:
 *   - Owner resolves to full access (zero behavior change for single-seat).
 *   - An active member passes ONLY its allowed permissions.
 *   - An inactive member is denied.
 *   - A non-member is denied.
 */

async function seedVendor(db: TestDB, vendorUserId: string): Promise<void> {
  await db.insert(users).values({ id: vendorUserId, email: `${vendorUserId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId: vendorUserId,
    businessName: 'Test Vendor',
    slug: `slug-${vendorUserId}`,
  })
}

describe('resolveVendorRole (ADR-0006)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('owner — acting user is the vendor account owner (active profile)', async () => {
    await seedVendor(db, 'u_owner')
    expect(await resolveVendorRole(db, 'u_owner', 'u_owner')).toBe('owner')
  })

  it('owner is null when the vendor profile is soft-closed', async () => {
    await seedVendor(db, 'u_owner')
    await db
      .update(vendorProfiles)
      .set({ closedAt: new Date() })
      .where(sql`user_id = 'u_owner'`)
    expect(await resolveVendorRole(db, 'u_owner', 'u_owner')).toBeNull()
  })

  it('active member resolves to its stored role', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_member', email: 'member@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_member',
      role: 'manager',
      status: 'active',
    })
    expect(await resolveVendorRole(db, 'u_owner', 'u_member')).toBe('manager')
  })

  it('inactive member resolves to null (denied)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_member', email: 'member@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_member',
      role: 'manager',
      status: 'inactive',
    })
    expect(await resolveVendorRole(db, 'u_owner', 'u_member')).toBeNull()
  })

  it('non-member resolves to null (denied)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_stranger', email: 'stranger@test.com' })
    expect(await resolveVendorRole(db, 'u_owner', 'u_stranger')).toBeNull()
  })

  it('a member of a DIFFERENT vendor account does not resolve here', async () => {
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other_owner')
    await db.insert(users).values({ id: 'u_member', email: 'member@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_other_owner',
      memberUserId: 'u_member',
      role: 'manager',
      status: 'active',
    })
    // u_member is a manager on u_other_owner's account, NOT on u_owner's.
    expect(await resolveVendorRole(db, 'u_owner', 'u_member')).toBeNull()
  })
})

describe('hasVendorAccess (ADR-0006) — boolean gate for Server Actions', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('owner passes every permission (zero behavior change for single-seat)', async () => {
    await seedVendor(db, 'u_owner')
    // The owner accesses their OWN account: vendorUserId === actingUserId.
    expect(await hasVendorAccess(db, 'u_owner', 'experiences:manage')).toBe(true)
    expect(await hasVendorAccess(db, 'u_owner', 'bank:manage')).toBe(true)
    expect(await hasVendorAccess(db, 'u_owner', 'account:close')).toBe(true)
    expect(await hasVendorAccess(db, 'u_owner', 'team:manage')).toBe(true)
  })

  it('a user with no vendor profile and no membership is denied', async () => {
    await db.insert(users).values({ id: 'u_nobody', email: 'nobody@test.com' })
    expect(await hasVendorAccess(db, 'u_nobody', 'bookings:read')).toBe(false)
  })

  it('active manager passes its allowed permissions and is denied the rest', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_mgr',
      role: 'manager',
      status: 'active',
    })
    // Manager accesses u_owner's account.
    expect(await hasVendorAccess(db, 'u_mgr', 'experiences:manage', 'u_owner')).toBe(true)
    expect(await hasVendorAccess(db, 'u_mgr', 'bookings:manage', 'u_owner')).toBe(true)
    expect(await hasVendorAccess(db, 'u_mgr', 'analytics:read', 'u_owner')).toBe(true)
    // Explicit denies.
    expect(await hasVendorAccess(db, 'u_mgr', 'bank:manage', 'u_owner')).toBe(false)
    expect(await hasVendorAccess(db, 'u_mgr', 'account:close', 'u_owner')).toBe(false)
    expect(await hasVendorAccess(db, 'u_mgr', 'team:manage', 'u_owner')).toBe(false)
  })

  it('inactive member is denied even an otherwise-allowed permission', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_mgr',
      role: 'manager',
      status: 'inactive',
    })
    expect(await hasVendorAccess(db, 'u_mgr', 'experiences:manage', 'u_owner')).toBe(false)
  })

  it('accountant is money-read-only (denied experiences/availability)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_acc', email: 'acc@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_acc',
      role: 'accountant',
      status: 'active',
    })
    expect(await hasVendorAccess(db, 'u_acc', 'payouts:read', 'u_owner')).toBe(true)
    expect(await hasVendorAccess(db, 'u_acc', 'experiences:manage', 'u_owner')).toBe(false)
    expect(await hasVendorAccess(db, 'u_acc', 'availability:manage', 'u_owner')).toBe(false)
  })

  it('defaults vendorUserId to the acting user (single-seat owner path)', async () => {
    await seedVendor(db, 'u_owner')
    // No explicit vendorUserId → resolves the acting user's own account.
    expect(await hasVendorAccess(db, 'u_owner', 'bookings:manage')).toBe(true)
  })
})

describe('requireVendorAccess (ADR-0006) — throwing gate for reads', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it('owner passes (does not throw)', async () => {
    await seedVendor(db, 'u_owner')
    await expect(
      requireVendorAccess(db, 'u_owner', 'experiences:manage'),
    ).resolves.not.toThrow()
  })

  it('non-member throws', async () => {
    await db.insert(users).values({ id: 'u_nobody', email: 'nobody@test.com' })
    await expect(
      requireVendorAccess(db, 'u_nobody', 'bookings:read'),
    ).rejects.toThrow()
  })

  it('active guide passes bookings:read but throws on experiences:manage', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_guide', email: 'guide@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_guide',
      role: 'guide',
      status: 'active',
    })
    await expect(
      requireVendorAccess(db, 'u_guide', 'bookings:read', 'u_owner'),
    ).resolves.not.toThrow()
    await expect(
      requireVendorAccess(db, 'u_guide', 'experiences:manage', 'u_owner'),
    ).rejects.toThrow()
  })
})

/**
 * FIX 1 (route-gate intent): the analytics + payouts read pages live inside
 * the `(dashboard)` route group and inherit only the layout's
 * `requireVendorAccess(..., 'bookings:read')` (held by every role). The matrix
 * must deny `analytics:read` for a Guide and `payouts:read` for both Guide and
 * Booking Staff, so each page is responsible for calling the narrower gate.
 * These integration assertions lock in the role→permission resolution that the
 * pages now enforce via `requireVendorAccess`.
 */
describe('analytics/payouts read-gate resolution (FIX 1, ADR-0006)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  async function seedMember(
    memberId: string,
    role: 'manager' | 'booking_staff' | 'guide' | 'accountant',
  ): Promise<void> {
    await db.insert(users).values({ id: memberId, email: `${memberId}@test.com` })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: memberId,
      role,
      status: 'active',
    })
  }

  it('guide is DENIED analytics:read (the analytics page gate)', async () => {
    await seedVendor(db, 'u_owner')
    await seedMember('u_guide', 'guide')
    expect(await hasVendorAccess(db, 'u_guide', 'analytics:read', 'u_owner')).toBe(false)
  })

  it('guide is DENIED payouts:read (the payouts page gate)', async () => {
    await seedVendor(db, 'u_owner')
    await seedMember('u_guide', 'guide')
    expect(await hasVendorAccess(db, 'u_guide', 'payouts:read', 'u_owner')).toBe(false)
  })

  it('booking_staff is DENIED payouts:read (the payouts page gate)', async () => {
    await seedVendor(db, 'u_owner')
    await seedMember('u_bs', 'booking_staff')
    expect(await hasVendorAccess(db, 'u_bs', 'payouts:read', 'u_owner')).toBe(false)
  })

  it('owner + accountant are ALLOWED payouts:read', async () => {
    await seedVendor(db, 'u_owner')
    await seedMember('u_acc', 'accountant')
    expect(await hasVendorAccess(db, 'u_owner', 'payouts:read')).toBe(true)
    expect(await hasVendorAccess(db, 'u_acc', 'payouts:read', 'u_owner')).toBe(true)
  })

  it('owner + manager are ALLOWED analytics:read', async () => {
    await seedVendor(db, 'u_owner')
    await seedMember('u_mgr', 'manager')
    expect(await hasVendorAccess(db, 'u_owner', 'analytics:read')).toBe(true)
    expect(await hasVendorAccess(db, 'u_mgr', 'analytics:read', 'u_owner')).toBe(true)
  })

  // The matrix denies above are only enforced at the route if each page CALLS
  // the narrower gate (the layout enforces just `bookings:read`). These guards
  // lock in that the analytics + payouts pages call `requireVendorAccess` with
  // the right permission — without them the denies are unenforced.
  // Issue #11 — the gate now keys on the RESOLVED shop (the explicit 4th arg),
  // with `acting` (the session user) as the acting-user arg, so a member is
  // authorized against the account they belong to, not their own id.
  it('analytics page gates on analytics:read for the resolved shop (route enforcement)', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/vendor/(dashboard)/analytics/page.tsx'),
      'utf-8',
    )
    expect(source).toContain("requireVendorAccess(db, acting, 'analytics:read', shop)")
  })

  it('payouts page gates on payouts:read for the resolved shop (route enforcement)', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'app/vendor/(dashboard)/payouts/page.tsx'),
      'utf-8',
    )
    expect(source).toContain("requireVendorAccess(db, acting, 'payouts:read', shop)")
  })
})

/**
 * FIX 2 — defense-in-depth: `role = 'owner'` must NEVER be storable as a
 * `vendor_team_members` row (Owner is implicit, resolved from
 * `vendor_profiles`). A CHECK constraint enforces this at the DB layer so a
 * future invite bug cannot grant DB-level owner.
 */
describe('vendor_team_members no-owner-role constraint (FIX 2, ADR-0006)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
  })

  it("rejects inserting a member row with role = 'owner'", async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_evil', email: 'evil@test.com' })
    await expect(
      db.insert(vendorTeamMembers).values({
        vendorUserId: 'u_owner',
        memberUserId: 'u_evil',
        role: 'owner',
        status: 'active',
      }),
    ).rejects.toThrow()
  })

  it('still accepts the four non-owner roles', async () => {
    await seedVendor(db, 'u_owner')
    for (const role of ['manager', 'booking_staff', 'guide', 'accountant'] as const) {
      const memberId = `u_${role}`
      await db.insert(users).values({ id: memberId, email: `${memberId}@test.com` })
      await expect(
        db.insert(vendorTeamMembers).values({
          vendorUserId: 'u_owner',
          memberUserId: memberId,
          role,
          status: 'active',
        }),
      ).resolves.not.toThrow()
    }
  })
})
