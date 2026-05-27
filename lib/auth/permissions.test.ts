import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  ADMIN_PERMISSIONS,
  FULL_ADMIN_PERMISSIONS,
  requirePermission,
  requireVendorProfile,
} from './permissions'

describe('requirePermission (ADR-0006)', () => {
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
      sql`TRUNCATE TABLE admin_profiles, vendor_profiles, users CASCADE`,
    )
  })

  it('full admin (all 16 permissions) passes any permission check', async () => {
    await db.insert(users).values({ id: 'u_admin', email: 'admin@test.com' })
    await db.insert(adminProfiles).values({
      userId: 'u_admin',
      permissions: [...FULL_ADMIN_PERMISSIONS],
    })

    // Should not throw for any permission
    for (const perm of ADMIN_PERMISSIONS) {
      await expect(requirePermission(db, 'u_admin', perm)).resolves.not.toThrow()
    }
  })

  it('sub-admin with [vendors, bookings] passes for vendors, blocked for payouts', async () => {
    await db.insert(users).values({ id: 'u_sub', email: 'sub@test.com' })
    await db.insert(adminProfiles).values({
      userId: 'u_sub',
      permissions: ['vendors', 'bookings'],
    })

    await expect(requirePermission(db, 'u_sub', 'vendors')).resolves.not.toThrow()
    await expect(requirePermission(db, 'u_sub', 'bookings')).resolves.not.toThrow()
    await expect(requirePermission(db, 'u_sub', 'payouts')).rejects.toThrow()
  })

  it('non-existent user throws (no admin_profiles row)', async () => {
    await expect(requirePermission(db, 'u_ghost', 'overview')).rejects.toThrow()
  })

  it('admin with empty permissions array fails all checks', async () => {
    await db.insert(users).values({ id: 'u_empty', email: 'empty@test.com' })
    await db.insert(adminProfiles).values({
      userId: 'u_empty',
      permissions: [],
    })

    for (const perm of ADMIN_PERMISSIONS) {
      await expect(requirePermission(db, 'u_empty', perm)).rejects.toThrow()
    }
  })

  it('ADMIN_PERMISSIONS has exactly 16 entries', () => {
    expect(ADMIN_PERMISSIONS).toHaveLength(16)
    expect(ADMIN_PERMISSIONS).toContain('overview')
    expect(ADMIN_PERMISSIONS).toContain('analytics')
    expect(ADMIN_PERMISSIONS).toContain('vendors')
    expect(ADMIN_PERMISSIONS).toContain('experiences')
    expect(ADMIN_PERMISSIONS).toContain('bookings')
    expect(ADMIN_PERMISSIONS).toContain('payouts')
    expect(ADMIN_PERMISSIONS).toContain('refunds')
    expect(ADMIN_PERMISSIONS).toContain('commission')
    expect(ADMIN_PERMISSIONS).toContain('region_closures')
    expect(ADMIN_PERMISSIONS).toContain('reviews')
    expect(ADMIN_PERMISSIONS).toContain('support')
    expect(ADMIN_PERMISSIONS).toContain('blog')
    expect(ADMIN_PERMISSIONS).toContain('site_builder')
    expect(ADMIN_PERMISSIONS).toContain('audit')
    expect(ADMIN_PERMISSIONS).toContain('sub_admins')
    expect(ADMIN_PERMISSIONS).toContain('reports')
  })

  it('FULL_ADMIN_PERMISSIONS matches ADMIN_PERMISSIONS', () => {
    expect([...FULL_ADMIN_PERMISSIONS]).toEqual([...ADMIN_PERMISSIONS])
  })
})

describe('requireVendorProfile (ADR-0006)', () => {
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
      sql`TRUNCATE TABLE admin_profiles, vendor_profiles, users CASCADE`,
    )
  })

  it('user with vendor_profiles row passes', async () => {
    await db.insert(users).values({ id: 'u_vendor', email: 'vendor@test.com' })
    await db.insert(vendorProfiles).values({
      userId: 'u_vendor',
      businessName: 'Test Biz',
      slug: 'test-biz',
    })

    await expect(requireVendorProfile(db, 'u_vendor')).resolves.not.toThrow()
  })

  it('user without vendor_profiles row is redirected', async () => {
    await db.insert(users).values({ id: 'u_novendor', email: 'novendor@test.com' })

    // redirect() from next/navigation throws internally
    await expect(requireVendorProfile(db, 'u_novendor')).rejects.toThrow()
  })

  it('non-existent user is redirected', async () => {
    await expect(requireVendorProfile(db, 'u_ghost')).rejects.toThrow()
  })
})
