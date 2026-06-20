import { sql } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { vendorTeamMembers } from '@/db/schema/vendor-team-members'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Integration tests (PGlite) for the per-request acting-Vendor context helpers
 * (issue #11, ADR-0006). These are the layer that turns "the signed-in human"
 * into "the Vendor account (shop) they operate on + their role":
 *
 *   - `getActingVendorContext` — page/layout variant. No session → redirect to
 *     /sign-in; otherwise delegates to `resolveActingVendorContext` (which
 *     itself redirects to /vendor/onboarding when there is no active context).
 *   - `requireVendorActionContext` — Server-Action gate. NON-redirecting: maps
 *     no-session / no-scope / insufficient-permission to a typed `{ error }`
 *     envelope, and on success returns `{ acting, shop, role }` — keeping the
 *     audit ACTOR (acting human) and the SCOPE (resolved shop) explicitly split.
 *
 * The DB resolution runs for real against PGlite; only the session read
 * (`auth.api.getSession`), the request `headers()`, and the `@/db/client`
 * handle are mocked. `redirect()` from `next/navigation` runs natively — it
 * throws a NEXT_REDIRECT error we assert on.
 */

// Mutable holders so the hoisted mocks resolve to per-test values.
let testDb: TestDB
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let currentSession: any = null

vi.mock('@/db/client', () => ({
  get db() {
    return testDb
  },
}))

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
}))

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: () => Promise.resolve(currentSession),
    },
  },
}))

// Imported AFTER the mocks are registered (vi.mock is hoisted, so this is safe).
const { getActingVendorContext, getCachedSession, requireVendorActionContext } =
  await import('./acting-context')

async function seedVendor(vendorUserId: string): Promise<void> {
  await testDb
    .insert(users)
    .values({ id: vendorUserId, email: `${vendorUserId}@test.com` })
  await testDb.insert(vendorProfiles).values({
    userId: vendorUserId,
    businessName: `Vendor ${vendorUserId}`,
    slug: `slug-${vendorUserId}`,
  })
}

describe('acting-context helpers (issue #11)', () => {
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    testDb = setup.db
    teardown = setup.teardown
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await testDb.execute(
      sql`TRUNCATE TABLE vendor_team_members, vendor_profiles, users CASCADE`,
    )
    currentSession = null
  })

  describe('getCachedSession', () => {
    it('returns the resolved session when one exists', async () => {
      currentSession = { user: { id: 'u_owner' } }
      const session = await getCachedSession()
      expect(session).toEqual({ user: { id: 'u_owner' } })
    })

    it('returns null when there is no session', async () => {
      currentSession = null
      const session = await getCachedSession()
      expect(session).toBeNull()
    })
  })

  describe('getActingVendorContext', () => {
    it('redirects to /sign-in when there is no session', async () => {
      currentSession = null
      await expect(getActingVendorContext()).rejects.toThrow(
        /NEXT_REDIRECT|\/sign-in/,
      )
    })

    it('redirects to /sign-in when the session has no user', async () => {
      currentSession = { user: null }
      await expect(getActingVendorContext()).rejects.toThrow(
        /NEXT_REDIRECT|\/sign-in/,
      )
    })

    it('resolves an owner to their own account with role owner', async () => {
      await seedVendor('u_owner')
      currentSession = { user: { id: 'u_owner' } }
      const ctx = await getActingVendorContext()
      expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'owner' })
    })

    it('resolves an active member to the shop + stored role', async () => {
      await seedVendor('u_owner')
      await testDb.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
      await testDb.insert(vendorTeamMembers).values({
        vendorUserId: 'u_owner',
        memberUserId: 'u_mgr',
        role: 'manager',
        status: 'active',
      })
      currentSession = { user: { id: 'u_mgr' } }
      const ctx = await getActingVendorContext()
      expect(ctx).toEqual({ vendorUserId: 'u_owner', role: 'manager' })
    })

    it('redirects to /vendor/onboarding for a profile-less non-member', async () => {
      await testDb
        .insert(users)
        .values({ id: 'u_nobody', email: 'nobody@test.com' })
      currentSession = { user: { id: 'u_nobody' } }
      await expect(getActingVendorContext()).rejects.toThrow(
        /NEXT_REDIRECT|\/vendor\/onboarding/,
      )
    })
  })

  describe('requireVendorActionContext', () => {
    it('returns an error envelope (no throw) when there is no session', async () => {
      currentSession = null
      const gate = await requireVendorActionContext('experiences:manage')
      expect(gate).toEqual({ error: 'Sign in to continue.' })
    })

    it('returns an error envelope when the session has no user', async () => {
      currentSession = { user: null }
      const gate = await requireVendorActionContext('experiences:manage')
      expect(gate).toEqual({ error: 'Sign in to continue.' })
    })

    it('returns the default denied message when there is no Vendor scope', async () => {
      await testDb
        .insert(users)
        .values({ id: 'u_nobody', email: 'nobody@test.com' })
      currentSession = { user: { id: 'u_nobody' } }
      const gate = await requireVendorActionContext('experiences:manage')
      expect(gate).toEqual({
        error: 'You do not have permission to perform this action.',
      })
    })

    it('honors a custom denied message when there is no scope', async () => {
      await testDb
        .insert(users)
        .values({ id: 'u_nobody', email: 'nobody@test.com' })
      currentSession = { user: { id: 'u_nobody' } }
      const gate = await requireVendorActionContext(
        'experiences:manage',
        'Become a Vendor first.',
      )
      expect(gate).toEqual({ error: 'Become a Vendor first.' })
    })

    it('denies an authenticated member who lacks the permission', async () => {
      // A guide may NOT manage experiences (experiences:manage is denied).
      await seedVendor('u_owner')
      await testDb
        .insert(users)
        .values({ id: 'u_guide', email: 'guide@test.com' })
      await testDb.insert(vendorTeamMembers).values({
        vendorUserId: 'u_owner',
        memberUserId: 'u_guide',
        role: 'guide',
        status: 'active',
      })
      currentSession = { user: { id: 'u_guide' } }
      const gate = await requireVendorActionContext(
        'experiences:manage',
        'Guides cannot edit listings.',
      )
      expect(gate).toEqual({ error: 'Guides cannot edit listings.' })
    })

    it('grants an owner: returns acting (audit) + shop (scope) + role', async () => {
      await seedVendor('u_owner')
      currentSession = { user: { id: 'u_owner' } }
      const gate = await requireVendorActionContext('experiences:manage')
      // Owner holds every permission. acting === the session human; shop ===
      // the resolved Vendor account (here the same id, owner of their own shop).
      expect(gate).toEqual({
        acting: 'u_owner',
        shop: 'u_owner',
        role: 'owner',
      })
    })

    it('grants a member with the permission, splitting acting vs shop', async () => {
      // A manager DOES hold experiences:manage. acting (the member) and shop
      // (the owner account they operate on) are DIFFERENT ids — the §5 split.
      await seedVendor('u_owner')
      await testDb.insert(users).values({ id: 'u_mgr', email: 'mgr@test.com' })
      await testDb.insert(vendorTeamMembers).values({
        vendorUserId: 'u_owner',
        memberUserId: 'u_mgr',
        role: 'manager',
        status: 'active',
      })
      currentSession = { user: { id: 'u_mgr' } }
      const gate = await requireVendorActionContext('experiences:manage')
      expect(gate).toEqual({
        acting: 'u_mgr',
        shop: 'u_owner',
        role: 'manager',
      })
    })

    it('denies a member when their role lacks the requested permission (team:manage)', async () => {
      // A manager may manage experiences but NOT the team — team:manage is the
      // owner-only permission. Proves per-permission gating, not just role gating.
      await seedVendor('u_owner')
      await testDb.insert(users).values({ id: 'u_mgr2', email: 'mgr2@test.com' })
      await testDb.insert(vendorTeamMembers).values({
        vendorUserId: 'u_owner',
        memberUserId: 'u_mgr2',
        role: 'manager',
        status: 'active',
      })
      currentSession = { user: { id: 'u_mgr2' } }
      const gate = await requireVendorActionContext('team:manage')
      expect(gate).toEqual({
        error: 'You do not have permission to perform this action.',
      })
    })
  })
})
