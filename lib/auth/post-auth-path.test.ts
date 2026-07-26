import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { resolvePostAuthPathForUser } from './post-auth-path'

/**
 * DB-injected core behind the sign-in page's resolvePostAuthPath Server
 * Action (launch-readiness 02). Role precedence Admin → Vendor →
 * Customer is unchanged from before returnTo existed; a sanitized
 * returnTo takes precedence over the role defaults; a hostile returnTo
 * silently falls back to role routing — never an error.
 */
describe('resolvePostAuthPathForUser', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_rt_cust', email: 'rt-cust@test.com', name: 'Customer' },
      { id: 'u_rt_vendor', email: 'rt-vendor@test.com', name: 'Vendor' },
      { id: 'u_rt_admin', email: 'rt-admin@test.com', name: 'Admin' },
      { id: 'u_rt_both', email: 'rt-both@test.com', name: 'Admin And Vendor' },
    ])
    await db.insert(vendorProfiles).values([
      { userId: 'u_rt_vendor', businessName: 'Rt Vendor Co', slug: 'rt-vendor-co' },
      { userId: 'u_rt_both', businessName: 'Rt Both Co', slug: 'rt-both-co' },
    ])
    await db.insert(adminProfiles).values([
      { userId: 'u_rt_admin', permissions: ['*'] },
      { userId: 'u_rt_both', permissions: ['*'] },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  describe('role precedence without returnTo (unchanged behaviour)', () => {
    it('routes an unauthenticated caller to /sign-in', async () => {
      expect(await resolvePostAuthPathForUser(db, null)).toBe('/sign-in')
    })

    it('routes a Customer to /dashboard', async () => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_cust')).toBe('/dashboard')
    })

    it('routes a Vendor to /vendor/dashboard', async () => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_vendor')).toBe('/vendor/dashboard')
    })

    it('routes an Admin to /admin/dashboard', async () => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_admin')).toBe('/admin/dashboard')
    })

    it('prefers Admin over Vendor for a multi-role User', async () => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_both')).toBe('/admin/dashboard')
    })
  })

  describe('sanitized returnTo takes precedence over role defaults', () => {
    it('sends a Customer with Vendor intent to onboarding', async () => {
      expect(
        await resolvePostAuthPathForUser(db, 'u_rt_cust', '/vendor/onboarding'),
      ).toBe('/vendor/onboarding')
    })

    it('honours returnTo for an Admin too (explicit intent wins)', async () => {
      expect(
        await resolvePostAuthPathForUser(db, 'u_rt_admin', '/vendor/onboarding'),
      ).toBe('/vendor/onboarding')
    })

    // An existing Vendor with returnTo=/vendor/onboarding is returned to
    // the wizard route, whose own guard (app/vendor/onboarding/page.tsx)
    // redirects profile-holders to /vendor/dashboard — the "no re-onboard"
    // rule lives there, once, not duplicated here. E2E asserts the final
    // destination.
    it('returns returnTo verbatim for a Vendor; the wizard route de-dupes onboarding', async () => {
      expect(
        await resolvePostAuthPathForUser(db, 'u_rt_vendor', '/vendor/onboarding'),
      ).toBe('/vendor/onboarding')
    })

    it('preserves query strings on the destination', async () => {
      expect(
        await resolvePostAuthPathForUser(db, 'u_rt_cust', '/vendor/onboarding?step=2'),
      ).toBe('/vendor/onboarding?step=2')
    })

    it('never honours returnTo for an unauthenticated caller', async () => {
      expect(await resolvePostAuthPathForUser(db, null, '/vendor/onboarding')).toBe(
        '/sign-in',
      )
    })
  })

  describe('unsafe returnTo falls back silently to role routing', () => {
    it.each([
      ['absolute URL', 'https://evil.com/vendor/onboarding'],
      ['protocol-relative', '//evil.com'],
      ['backslash variant', '/\\evil.com'],
      ['javascript scheme', 'javascript:alert(1)'],
      ['traversal', '/vendor/../admin'],
      ['empty string', ''],
      ['whitespace', '   '],
    ])('%s → Customer lands on /dashboard', async (_label, raw) => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_cust', raw)).toBe('/dashboard')
    })

    it('falls back to the Admin dashboard for an Admin', async () => {
      expect(
        await resolvePostAuthPathForUser(db, 'u_rt_admin', 'https://evil.com'),
      ).toBe('/admin/dashboard')
    })

    it('falls back to the Vendor dashboard for a Vendor', async () => {
      expect(await resolvePostAuthPathForUser(db, 'u_rt_vendor', '//evil.com')).toBe(
        '/vendor/dashboard',
      )
    })
  })
})
