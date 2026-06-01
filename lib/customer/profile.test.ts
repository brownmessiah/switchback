import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { updateCustomerProfile } from './profile'

/**
 * Pure-core profile editor exercised directly against PGlite. The Server
 * Action wrapper (app/(app)/settings/actions.ts) adds only the auth layer.
 *
 * Contract:
 *  - Zod-validated; returns `{ ok: false, error }` on bad input.
 *  - Updates users.name / users.image AND the customer_profiles row
 *    (defaultAddress jsonb + trusted-contact fields) in ONE transaction.
 *  - Upserts the customer_profiles row when none exists (a fresh User may
 *    not yet have a profile row).
 */
describe('updateCustomerProfile', () => {
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
    await db.delete(customerProfiles)
    await db.delete(users)
    await db.insert(users).values({ id: 'u_1', email: 'c@example.com', name: 'Old Name' })
    await db.insert(customerProfiles).values({ userId: 'u_1' })
  })

  it('updates users.name and users.image', async () => {
    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: 'New Name',
      avatarUrl: 'https://cdn.example.com/a.png',
      address: { line1: '1 MG Rd', city: 'Bengaluru', state: 'KA', pincode: '560001' },
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(true)
    const [u] = await db.select().from(users).where(eq(users.id, 'u_1'))
    expect(u?.name).toBe('New Name')
    expect(u?.image).toBe('https://cdn.example.com/a.png')
  })

  it('persists the default address jsonb + trusted contact on customer_profiles', async () => {
    await updateCustomerProfile(db, 'u_1', {
      displayName: 'Jane',
      avatarUrl: null,
      address: { line1: '5 Beach Rd', city: 'Goa', state: 'GA', pincode: '403001' },
      trustedContactName: 'Asha',
      trustedContactPhone: '+919812345678',
      trustedContactRelationship: 'Sister',
    })

    const [p] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, 'u_1'))
    expect(p?.defaultAddress).toEqual({
      line1: '5 Beach Rd',
      city: 'Goa',
      state: 'GA',
      pincode: '403001',
    })
    expect(p?.trustedContactName).toBe('Asha')
    expect(p?.trustedContactPhone).toBe('+919812345678')
    expect(p?.trustedContactRelationship).toBe('Sister')
  })

  it('upserts a customer_profiles row when none exists yet', async () => {
    await db.delete(customerProfiles)

    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: 'Solo',
      avatarUrl: null,
      address: { line1: '9 Hill St', city: 'Manali', state: 'HP', pincode: '175131' },
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(true)
    const [p] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, 'u_1'))
    expect(p?.userId).toBe('u_1')
    expect(p?.defaultAddress).toMatchObject({ city: 'Manali' })
  })

  it('rejects an empty display name', async () => {
    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: '   ',
      avatarUrl: null,
      address: null,
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/name/i)
    const [u] = await db.select().from(users).where(eq(users.id, 'u_1'))
    expect(u?.name).toBe('Old Name') // unchanged on validation failure
  })

  it('rejects an invalid avatar URL', async () => {
    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: 'Jane',
      avatarUrl: 'not-a-url',
      address: null,
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/url|avatar|image/i)
  })

  it('rejects an invalid pincode', async () => {
    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: 'Jane',
      avatarUrl: null,
      address: { line1: '1 MG Rd', city: 'Bengaluru', state: 'KA', pincode: '12' },
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/pincode/i)
  })

  it('allows clearing the address and trusted contact with nulls', async () => {
    // Seed an address first.
    await updateCustomerProfile(db, 'u_1', {
      displayName: 'Jane',
      avatarUrl: null,
      address: { line1: '1 MG Rd', city: 'Bengaluru', state: 'KA', pincode: '560001' },
      trustedContactName: 'Asha',
      trustedContactPhone: '+919812345678',
      trustedContactRelationship: 'Sister',
    })

    const result = await updateCustomerProfile(db, 'u_1', {
      displayName: 'Jane',
      avatarUrl: null,
      address: null,
      trustedContactName: null,
      trustedContactPhone: null,
      trustedContactRelationship: null,
    })

    expect(result.ok).toBe(true)
    const [p] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, 'u_1'))
    expect(p?.defaultAddress).toBeNull()
    expect(p?.trustedContactName).toBeNull()
  })
})
