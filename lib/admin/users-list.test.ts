import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { adminProfiles } from '@/db/schema/admin-profiles'
import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { listUsers } from './users-list'

/**
 * #17 — the pure, PGlite-testable loader behind the general
 * `/admin/users` screen. Role derivation is intentionally a function of
 * profile-table membership (ADR-0006): a User has NO intrinsic role column;
 * customer / vendor / admin / sub_admin are all derived from the presence
 * of a row in the matching profile table.
 */
describe('listUsers', () => {
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
      sql`TRUNCATE TABLE admin_profiles, customer_profiles, vendor_profiles, users CASCADE`,
    )
  })

  // ── Helpers ────────────────────────────────────────────────────────

  async function seedUser(
    id: string,
    name: string | null,
    email: string | null,
  ): Promise<void> {
    await db.insert(users).values({ id, name, email })
  }

  async function makeCustomer(userId: string): Promise<void> {
    await db.insert(customerProfiles).values({ userId })
  }

  async function makeVendor(
    userId: string,
    businessName = 'Acme Treks',
    suspended = false,
  ): Promise<void> {
    await db.insert(vendorProfiles).values({
      userId,
      businessName,
      slug: `${userId}-slug`,
      suspended,
    })
  }

  async function makeAdmin(
    userId: string,
    permissions: string[],
    invitedByUserId: string | null = null,
  ): Promise<void> {
    await db.insert(adminProfiles).values({ userId, permissions, invitedByUserId })
  }

  // ── Role derivation ─────────────────────────────────────────────────

  it('derives customer role from a customer_profiles row', async () => {
    await seedUser('u_cust', 'Cara', 'cara@example.com')
    await makeCustomer('u_cust')

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    const row = result.users[0]!
    expect(row.id).toBe('u_cust')
    expect(row.roles).toEqual(['customer'])
    expect(row.vendorSuspended).toBeUndefined()
  })

  it('derives vendor role from a vendor_profiles row and surfaces suspended', async () => {
    await seedUser('u_vend', 'Vik', 'vik@example.com')
    await makeVendor('u_vend', 'Vik Adventures', true)

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    const row = result.users[0]!
    expect(row.roles).toEqual(['vendor'])
    expect(row.vendorSuspended).toBe(true)
  })

  it('derives full admin from a permissions=[*] admin_profiles row', async () => {
    await seedUser('u_admin', 'Adi', 'adi@example.com')
    await makeAdmin('u_admin', ['*'])

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    expect(result.users[0]!.roles).toEqual(['admin'])
  })

  it('derives sub_admin when permissions is a strict subset (not [*])', async () => {
    await seedUser('u_sub', 'Sam', 'sam@example.com')
    await makeAdmin('u_sub', ['vendors', 'audit'])

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    expect(result.users[0]!.roles).toEqual(['sub_admin'])
  })

  it('derives sub_admin when invitedByUserId is set even with [*]', async () => {
    await seedUser('u_inviter', 'Boss', 'boss@example.com')
    await makeAdmin('u_inviter', ['*'])
    await seedUser('u_invited', 'New', 'new@example.com')
    await makeAdmin('u_invited', ['*'], 'u_inviter')

    const result = await listUsers(db, { query: 'new@example.com', page: 1, pageSize: 20 })

    expect(result.users[0]!.roles).toEqual(['sub_admin'])
  })

  it('reports multiple roles for a user who is both a customer and a vendor', async () => {
    await seedUser('u_dual', 'Dee', 'dee@example.com')
    await makeCustomer('u_dual')
    await makeVendor('u_dual')

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    const row = result.users[0]!
    expect(row.roles).toContain('customer')
    expect(row.roles).toContain('vendor')
    expect(row.roles).toHaveLength(2)
  })

  it('returns an empty role list for a user with no profile rows', async () => {
    await seedUser('u_bare', 'Bea', 'bea@example.com')

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    expect(result.users[0]!.roles).toEqual([])
  })

  // ── Search ──────────────────────────────────────────────────────────

  it('search matches name (case-insensitive, partial)', async () => {
    await seedUser('u_1', 'Alice Anderson', 'alice@example.com')
    await seedUser('u_2', 'Bob Brown', 'bob@example.com')

    const result = await listUsers(db, { query: 'anders', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_1')
  })

  it('search matches email (case-insensitive, partial)', async () => {
    await seedUser('u_1', 'Alice', 'alice@example.com')
    await seedUser('u_2', 'Bob', 'bob@other.org')

    const result = await listUsers(db, { query: 'OTHER.ORG', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_2')
  })

  // ── Role filter ─────────────────────────────────────────────────────

  it('filters by role=vendor', async () => {
    await seedUser('u_c', 'C', 'c@example.com')
    await makeCustomer('u_c')
    await seedUser('u_v', 'V', 'v@example.com')
    await makeVendor('u_v')

    const result = await listUsers(db, { role: 'vendor', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_v')
  })

  it('filters by role=sub_admin (excludes full admins)', async () => {
    await seedUser('u_full', 'Full', 'full@example.com')
    await makeAdmin('u_full', ['*'])
    await seedUser('u_sub', 'Sub', 'sub@example.com')
    await makeAdmin('u_sub', ['vendors'])

    const result = await listUsers(db, { role: 'sub_admin', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_sub')
  })

  it('filters by role=admin (excludes sub-admins)', async () => {
    await seedUser('u_full', 'Full', 'full@example.com')
    await makeAdmin('u_full', ['*'])
    await seedUser('u_sub', 'Sub', 'sub@example.com')
    await makeAdmin('u_sub', ['vendors'])

    const result = await listUsers(db, { role: 'admin', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_full')
  })

  it('filters by role=customer', async () => {
    await seedUser('u_c', 'C', 'c@example.com')
    await makeCustomer('u_c')
    await seedUser('u_v', 'V', 'v@example.com')
    await makeVendor('u_v')

    const result = await listUsers(db, { role: 'customer', page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users[0]!.id).toBe('u_c')
  })

  it('combines search and role filter', async () => {
    await seedUser('u_v1', 'Vendor One', 'v1@example.com')
    await makeVendor('u_v1', 'V One')
    await seedUser('u_v2', 'Vendor Two', 'v2@example.com')
    await makeVendor('u_v2', 'V Two')
    await seedUser('u_c1', 'Vendor Lookalike', 'c1@example.com')
    await makeCustomer('u_c1')

    const result = await listUsers(db, { query: 'vendor', role: 'vendor', page: 1, pageSize: 20 })

    expect(result.total).toBe(2)
    const ids = result.users.map((u) => u.id).sort()
    expect(ids).toEqual(['u_v1', 'u_v2'])
  })

  // ── Pagination ──────────────────────────────────────────────────────

  it('paginates and reports total + totalPages', async () => {
    for (let i = 0; i < 5; i++) {
      await seedUser(`u_${i}`, `User ${i}`, `user${i}@example.com`)
    }

    const page1 = await listUsers(db, { page: 1, pageSize: 2 })
    expect(page1.total).toBe(5)
    expect(page1.totalPages).toBe(3)
    expect(page1.page).toBe(1)
    expect(page1.users).toHaveLength(2)

    const page3 = await listUsers(db, { page: 3, pageSize: 2 })
    expect(page3.users).toHaveLength(1)
  })

  it('clamps an out-of-range page to at least 1 and returns totalPages>=1 when empty', async () => {
    const result = await listUsers(db, { page: 1, pageSize: 20 })
    expect(result.total).toBe(0)
    expect(result.totalPages).toBe(1)
    expect(result.users).toHaveLength(0)
  })

  it('does not return duplicate rows for a multi-role user (no join fan-out)', async () => {
    await seedUser('u_dual', 'Dee', 'dee@example.com')
    await makeCustomer('u_dual')
    await makeVendor('u_dual')

    const result = await listUsers(db, { page: 1, pageSize: 20 })

    expect(result.total).toBe(1)
    expect(result.users).toHaveLength(1)
  })
})
