import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { adminProfiles } from './admin-profiles'
import { customerProfiles } from './customer-profiles'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('users + profile schema (ADR-0006)', () => {
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
    // Truncate every test data table to keep cases isolated. Cascade
    // wipes the dependent profile rows too.
    await db.execute(sql`TRUNCATE TABLE users CASCADE`)
  })

  it('inserts a User row with email + phoneNumber unique', async () => {
    await db.insert(users).values({
      id: 'u_1',
      email: 'shivam@example.com',
      phoneNumber: '+919876543210',
      name: 'Shivam Chauhan',
    })

    const rows = await db.select().from(users).where(eq(users.id, 'u_1'))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe('shivam@example.com')
    expect(rows[0]?.emailVerified).toBe(false)
    expect(rows[0]?.phoneNumberVerified).toBe(false)
  })

  it('rejects duplicate emails', async () => {
    await db.insert(users).values({ id: 'u_1', email: 'a@example.com' })
    await expect(
      db.insert(users).values({ id: 'u_2', email: 'a@example.com' }),
    ).rejects.toThrow()
  })

  it('rejects duplicate phoneNumbers', async () => {
    await db.insert(users).values({ id: 'u_1', phoneNumber: '+919999999999' })
    await expect(
      db.insert(users).values({ id: 'u_2', phoneNumber: '+919999999999' }),
    ).rejects.toThrow()
  })

  it('attaches all three profiles to a single User (multi-role per ADR-0006)', async () => {
    await db.insert(users).values({ id: 'u_1', email: 'multi@example.com' })

    await db.insert(customerProfiles).values({ userId: 'u_1' })
    await db.insert(vendorProfiles).values({
      userId: 'u_1',
      businessName: 'Multi-Role Adventures',
      slug: 'multi-role-adventures',
    })
    await db.insert(adminProfiles).values({
      userId: 'u_1',
      permissions: ['refunds:approve', 'vendors:verify'],
    })

    const [customer] = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, 'u_1'))
    const [vendor] = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_1'))
    const [admin] = await db
      .select()
      .from(adminProfiles)
      .where(eq(adminProfiles.userId, 'u_1'))

    expect(customer?.userId).toBe('u_1')
    expect(vendor?.userId).toBe('u_1')
    expect(admin?.userId).toBe('u_1')
    expect(admin?.permissions).toEqual(['refunds:approve', 'vendors:verify'])
  })

  it('cascades profile deletes when a User is removed', async () => {
    await db.insert(users).values({ id: 'u_1', email: 'cascade@example.com' })
    await db.insert(customerProfiles).values({ userId: 'u_1' })
    await db.insert(vendorProfiles).values({
      userId: 'u_1',
      businessName: 'X',
      slug: 'x',
    })

    await db.delete(users).where(eq(users.id, 'u_1'))

    const customers = await db
      .select()
      .from(customerProfiles)
      .where(eq(customerProfiles.userId, 'u_1'))
    const vendors = await db
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_1'))
    expect(customers).toHaveLength(0)
    expect(vendors).toHaveLength(0)
  })

  describe('vendor_profiles (ADR-0007 / ADR-0008 / ADR-0016)', () => {
    it('defaults kycTier to phone and commissionRate to 20.00', async () => {
      await db.insert(users).values({ id: 'u_v', email: 'v@example.com' })
      await db.insert(vendorProfiles).values({
        userId: 'u_v',
        businessName: 'Defaults Co',
        slug: 'defaults-co',
      })

      const [vendor] = await db
        .select()
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, 'u_v'))
      expect(vendor?.kycTier).toBe('phone')
      expect(vendor?.commissionRate).toBe('20.00')
      expect(vendor?.manualPayoutsRemaining).toBe(3)
      expect(vendor?.responseTimeSlaScore).toBe('100.00')
    })

    it('enforces slug uniqueness across vendors', async () => {
      await db.insert(users).values([
        { id: 'u_a', email: 'a@example.com' },
        { id: 'u_b', email: 'b@example.com' },
      ])
      await db.insert(vendorProfiles).values({
        userId: 'u_a',
        businessName: 'A',
        slug: 'same-slug',
      })
      await expect(
        db.insert(vendorProfiles).values({
          userId: 'u_b',
          businessName: 'B',
          slug: 'same-slug',
        }),
      ).rejects.toThrow()
    })

    it('accepts kycTier transitions phone → identity → business', async () => {
      await db.insert(users).values({ id: 'u_t', email: 't@example.com' })
      await db.insert(vendorProfiles).values({
        userId: 'u_t',
        businessName: 'Transitions Co',
        slug: 'transitions-co',
      })

      await db
        .update(vendorProfiles)
        .set({ kycTier: 'identity' })
        .where(eq(vendorProfiles.userId, 'u_t'))
      const [identityRow] = await db
        .select()
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, 'u_t'))
      expect(identityRow?.kycTier).toBe('identity')

      await db
        .update(vendorProfiles)
        .set({ kycTier: 'business' })
        .where(eq(vendorProfiles.userId, 'u_t'))
      const [businessRow] = await db
        .select()
        .from(vendorProfiles)
        .where(eq(vendorProfiles.userId, 'u_t'))
      expect(businessRow?.kycTier).toBe('business')
    })

    it('rejects unknown kycTier enum values', async () => {
      await db.insert(users).values({ id: 'u_x', email: 'x@example.com' })
      await expect(
        db.execute(
          sql`INSERT INTO vendor_profiles(user_id, business_name, slug, kyc_tier) VALUES ('u_x', 'X', 'x', 'unknown_tier')`,
        ),
      ).rejects.toThrow()
    })
  })

  describe('customer_profiles (ADR-0009)', () => {
    it('defaults aadhaarGenderVerified to unverified', async () => {
      await db.insert(users).values({ id: 'u_c', email: 'c@example.com' })
      await db.insert(customerProfiles).values({ userId: 'u_c' })

      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, 'u_c'))
      expect(profile?.aadhaarGenderVerified).toBe('unverified')
      expect(profile?.preferredLanguage).toBe('en')
      expect(profile?.wishlist).toEqual([])
    })

    it('accepts all four aadhaarGenderVerified enum values', async () => {
      const values = ['female', 'male', 'other', 'unverified'] as const
      for (const [i, value] of values.entries()) {
        const id = `u_g_${i}`
        await db.insert(users).values({ id })
        await db.insert(customerProfiles).values({
          userId: id,
          aadhaarGenderVerified: value,
        })
        const [row] = await db
          .select()
          .from(customerProfiles)
          .where(eq(customerProfiles.userId, id))
        expect(row?.aadhaarGenderVerified).toBe(value)
      }
    })

    it('stores trusted-contact triple for safety-stack Bookings (ADR-0015)', async () => {
      await db.insert(users).values({ id: 'u_tc', email: 'tc@example.com' })
      await db.insert(customerProfiles).values({
        userId: 'u_tc',
        trustedContactName: 'Maa',
        trustedContactPhone: '+919999988888',
        trustedContactRelationship: 'parent',
      })

      const [profile] = await db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, 'u_tc'))
      expect(profile?.trustedContactName).toBe('Maa')
      expect(profile?.trustedContactPhone).toBe('+919999988888')
      expect(profile?.trustedContactRelationship).toBe('parent')
    })
  })

  describe('admin_profiles (ADR-0006 sub-admin model)', () => {
    it('stores permissions as text[] (sub-admin = restricted permission set)', async () => {
      await db.insert(users).values([
        { id: 'u_full', email: 'full@example.com' },
        { id: 'u_sub', email: 'sub@example.com' },
      ])
      await db.insert(adminProfiles).values({
        userId: 'u_full',
        permissions: ['*'],
      })
      await db.insert(adminProfiles).values({
        userId: 'u_sub',
        permissions: ['refunds:approve'],
        invitedByUserId: 'u_full',
      })

      const [sub] = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'u_sub'))
      expect(sub?.permissions).toEqual(['refunds:approve'])
      expect(sub?.invitedByUserId).toBe('u_full')
    })

    it('sets invited_by_user_id to NULL when the inviter is deleted', async () => {
      await db.insert(users).values([
        { id: 'u_inviter', email: 'inv@example.com' },
        { id: 'u_invitee', email: 'inv2@example.com' },
      ])
      await db.insert(adminProfiles).values({
        userId: 'u_invitee',
        permissions: ['x'],
        invitedByUserId: 'u_inviter',
      })

      await db.delete(users).where(eq(users.id, 'u_inviter'))

      const [row] = await db
        .select()
        .from(adminProfiles)
        .where(eq(adminProfiles.userId, 'u_invitee'))
      expect(row?.invitedByUserId).toBeNull()
    })
  })
})
