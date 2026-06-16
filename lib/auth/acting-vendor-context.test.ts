import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { resolveActingVendorContext, resolveActingVendorScope } from './permissions'

/**
 * Integration tests (PGlite) for `resolveActingVendorContext` (issue #11).
 *
 * The single-account (NO switcher) resolver that the dashboard layout + every
 * vendor page calls to learn `{ vendorUserId (shop), role }` for the acting
 * human. Resolution precedence:
 *   1. Owner (own active vendor_profiles row) → own account, role owner.
 *   2. else earliest-invited ACTIVE membership → that shop + stored role.
 *   3. else redirect to /vendor/onboarding (profile-less non-member, OR a
 *      closed-only profile with no active membership).
 */

async function seedVendor(db: TestDB, vendorUserId: string): Promise<void> {
  await db.insert(users).values({ id: vendorUserId, email: `${vendorUserId}@test.com` })
  await db.insert(vendorProfiles).values({
    userId: vendorUserId,
    businessName: `Vendor ${vendorUserId}`,
    slug: `slug-${vendorUserId}`,
  })
}

describe('resolveActingVendorContext (issue #11)', () => {
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

  it('owner: an active profile resolves to own account with role owner', async () => {
    await seedVendor(db, 'u_owner')
    const ctx = await resolveActingVendorContext(db, 'u_owner')
    expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'owner' })
  })

  it('single membership: an active member resolves to the shop + stored role', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_mgr',
      role: 'manager',
      status: 'active',
    })
    const ctx = await resolveActingVendorContext(db, 'u_mgr')
    expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'manager' })
  })

  it('owner precedence: an owner who is ALSO a member elsewhere resolves to OWN account', async () => {
    // u_owner owns shop A and is a member of shop B. Owner wins.
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_other')
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_other',
      memberUserId: 'u_owner',
      role: 'manager',
      status: 'active',
    })
    const ctx = await resolveActingVendorContext(db, 'u_owner')
    expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'owner' })
  })

  it('closed-owner-with-membership fall-through: a closed profile is not owner; the active membership wins', async () => {
    // u_x has a CLOSED profile (closedAt set) and is an active member of shop A.
    // Step 1 (owner) falls through; step 2 resolves the membership.
    await seedVendor(db, 'u_owner')
    await seedVendor(db, 'u_x')
    await db
      .update(vendorProfiles)
      .set({ closedAt: new Date() })
      .where(sql`user_id = 'u_x'`)
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_x',
      role: 'guide',
      status: 'active',
    })
    const ctx = await resolveActingVendorContext(db, 'u_x')
    expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'guide' })
  })

  it('multi-membership tie-break: earliest invitedAt wins (deterministic v1, switcher is v2)', async () => {
    await seedVendor(db, 'u_a')
    await seedVendor(db, 'u_b')
    await db.insert(users).values({ id: 'u_multi', email: 'multi@test.com' })
    // Member of B (invited LATER) and A (invited EARLIER). Earliest-invited (A) wins.
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_b',
      memberUserId: 'u_multi',
      role: 'accountant',
      status: 'active',
      invitedAt: new Date('2026-02-01T00:00:00Z'),
    })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_a',
      memberUserId: 'u_multi',
      role: 'manager',
      status: 'active',
      invitedAt: new Date('2026-01-01T00:00:00Z'),
    })
    const ctx = await resolveActingVendorContext(db, 'u_multi')
    expect(ctx).toEqual({ vendorUserId: 'u_a', role: 'manager' })
  })

  it('multi-membership null-invitedAt tie-break: falls back to vendorUserId ASC', async () => {
    // Both memberships have NULL invitedAt → deterministic vendorUserId ASC.
    await seedVendor(db, 'u_aaa')
    await seedVendor(db, 'u_zzz')
    await db.insert(users).values({ id: 'u_multi2', email: 'multi2@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_zzz',
      memberUserId: 'u_multi2',
      role: 'accountant',
      status: 'active',
    })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_aaa',
      memberUserId: 'u_multi2',
      role: 'manager',
      status: 'active',
    })
    const ctx = await resolveActingVendorContext(db, 'u_multi2')
    expect(ctx).toEqual({ vendorUserId: 'u_aaa', role: 'manager' })
  })

  it('inactive-only membership: does NOT resolve (redirects to onboarding)', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_inactive', email: 'inactive@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_inactive',
      role: 'manager',
      status: 'inactive',
    })
    await expect(resolveActingVendorContext(db, 'u_inactive')).rejects.toThrow(
      /NEXT_REDIRECT|\/vendor\/onboarding/,
    )
  })

  it('profile-less non-member: redirects to onboarding', async () => {
    await db.insert(users).values({ id: 'u_nobody', email: 'nobody@test.com' })
    await expect(resolveActingVendorContext(db, 'u_nobody')).rejects.toThrow(
      /NEXT_REDIRECT|\/vendor\/onboarding/,
    )
  })

  it('closed-only profile with no active membership: redirects to onboarding', async () => {
    await seedVendor(db, 'u_closed')
    await db
      .update(vendorProfiles)
      .set({ closedAt: new Date() })
      .where(sql`user_id = 'u_closed'`)
    await expect(resolveActingVendorContext(db, 'u_closed')).rejects.toThrow(
      /NEXT_REDIRECT|\/vendor\/onboarding/,
    )
  })
})

/**
 * The non-redirecting sibling for Server Actions (issue #11). Same resolution
 * as {@link resolveActingVendorContext} but returns `null` instead of
 * redirecting, so an action can map "no context" to a typed error envelope.
 */
describe('resolveActingVendorScope (issue #11 — action variant)', () => {
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

  it('owner resolves to own account', async () => {
    await seedVendor(db, 'u_owner')
    expect(await resolveActingVendorScope(db, 'u_owner')).toEqual({
      vendorUserId: 'u_owner',
      role: 'owner',
    })
  })

  it('active member resolves to the shop + role', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_mgr',
      role: 'manager',
      status: 'active',
    })
    expect(await resolveActingVendorScope(db, 'u_mgr')).toEqual({
      vendorUserId: 'u_owner',
      role: 'manager',
    })
  })

  it('no context returns null (does NOT redirect/throw)', async () => {
    await db.insert(users).values({ id: 'u_nobody', email: 'nobody@test.com' })
    expect(await resolveActingVendorScope(db, 'u_nobody')).toBeNull()
  })

  it('inactive-only membership returns null', async () => {
    await seedVendor(db, 'u_owner')
    await db.insert(users).values({ id: 'u_inactive', email: 'inactive@test.com' })
    await db.insert(vendorTeamMembers).values({
      vendorUserId: 'u_owner',
      memberUserId: 'u_inactive',
      role: 'manager',
      status: 'inactive',
    })
    expect(await resolveActingVendorScope(db, 'u_inactive')).toBeNull()
  })
})
