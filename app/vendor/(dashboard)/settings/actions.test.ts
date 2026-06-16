import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeUpdateBusinessDetails,
  executeUpdatePayoutMethod,
} from './settings-cores'

describe('executeUpdateBusinessDetails', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_settings_vendor', email: 'settings-vendor@test.com', name: 'Settings Vendor' },
      { id: 'u_other_settings', email: 'other-settings@test.com', name: 'Other Vendor' },
    ])

    await db.insert(vendorProfiles).values([
      {
        userId: 'u_settings_vendor',
        businessName: 'Original Business',
        slug: 'original-business',
      },
      {
        userId: 'u_other_settings',
        businessName: 'Other Business',
        slug: 'other-business',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Reset business name, slug, about to original values
    await db
      .update(vendorProfiles)
      .set({
        businessName: 'Original Business',
        slug: 'original-business',
        about: null,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, 'u_settings_vendor'))

    await db
      .update(vendorProfiles)
      .set({
        businessName: 'Other Business',
        slug: 'other-business',
        about: null,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, 'u_other_settings'))
  })

  it('persists businessName, slug, and about', async () => {
    const result = await executeUpdateBusinessDetails(
      db,
      'u_settings_vendor',
      {
        businessName: 'New Business Name',
        slug: 'new-business-name',
        about: 'We offer great experiences.',
      },
    )

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({
        businessName: vendorProfiles.businessName,
        slug: vendorProfiles.slug,
        about: vendorProfiles.about,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_settings_vendor'))

    expect(updated.businessName).toBe('New Business Name')
    expect(updated.slug).toBe('new-business-name')
    expect(updated.about).toBe('We offer great experiences.')
  })

  it('rejects duplicate slug (taken by another vendor)', async () => {
    const result = await executeUpdateBusinessDetails(
      db,
      'u_settings_vendor',
      {
        businessName: 'New Name',
        slug: 'other-business', // taken by u_other_settings
        about: null,
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/slug.*taken|already.*taken/i)
    }
  })

  it('allows keeping the same slug (no change)', async () => {
    const result = await executeUpdateBusinessDetails(
      db,
      'u_settings_vendor',
      {
        businessName: 'Updated Name',
        slug: 'original-business', // same slug, no conflict
        about: null,
      },
    )

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({ businessName: vendorProfiles.businessName })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_settings_vendor'))

    expect(updated.businessName).toBe('Updated Name')
  })

  it('rejects empty businessName', async () => {
    const result = await executeUpdateBusinessDetails(
      db,
      'u_settings_vendor',
      {
        businessName: '',
        slug: 'some-slug',
        about: null,
      },
    )

    expect(result.ok).toBe(false)
  })

  it('rejects invalid slug format', async () => {
    const result = await executeUpdateBusinessDetails(
      db,
      'u_settings_vendor',
      {
        businessName: 'Valid Name',
        slug: 'Invalid Slug!',
        about: null,
      },
    )

    expect(result.ok).toBe(false)
  })

  it('allows null about (clears about)', async () => {
    // First set about
    await executeUpdateBusinessDetails(db, 'u_settings_vendor', {
      businessName: 'Name',
      slug: 'original-business',
      about: 'Some about text',
    })

    // Then clear it
    const result = await executeUpdateBusinessDetails(db, 'u_settings_vendor', {
      businessName: 'Name',
      slug: 'original-business',
      about: null,
    })

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({ about: vendorProfiles.about })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_settings_vendor'))

    expect(updated.about).toBeNull()
  })
})

describe('executeUpdatePayoutMethod', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_payout_vendor', email: 'payout-vendor@test.com', name: 'Payout Vendor' },
    ])

    await db.insert(vendorProfiles).values([
      {
        userId: 'u_payout_vendor',
        businessName: 'Payout Business',
        slug: 'payout-business',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    // Reset payout fields
    await db
      .update(vendorProfiles)
      .set({
        payoutMethod: null,
        payoutDestination: null,
        payoutDestinationChangedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(vendorProfiles.userId, 'u_payout_vendor'))
  })

  it('sets UPI VPA payout method and destination', async () => {
    const result = await executeUpdatePayoutMethod(
      db,
      'u_payout_vendor',
      {
        payoutMethod: 'upi',
        payoutDestination: { vpa: 'vendor@upi' },
      },
    )

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({
        payoutMethod: vendorProfiles.payoutMethod,
        payoutDestination: vendorProfiles.payoutDestination,
        payoutDestinationChangedAt: vendorProfiles.payoutDestinationChangedAt,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_payout_vendor'))

    expect(updated.payoutMethod).toBe('upi')
    expect(updated.payoutDestination).toEqual({ vpa: 'vendor@upi' })
    expect(updated.payoutDestinationChangedAt).toBeInstanceOf(Date)
  })

  it('sets bank account payout method and destination', async () => {
    const result = await executeUpdatePayoutMethod(
      db,
      'u_payout_vendor',
      {
        payoutMethod: 'bank_account',
        payoutDestination: {
          accountNumber: '1234567890',
          ifsc: 'HDFC0001234',
          accountHolderName: 'Payout Vendor',
        },
      },
    )

    expect(result.ok).toBe(true)

    const [updated] = await db
      .select({
        payoutMethod: vendorProfiles.payoutMethod,
        payoutDestination: vendorProfiles.payoutDestination,
      })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_payout_vendor'))

    expect(updated.payoutMethod).toBe('bank_account')
    expect(updated.payoutDestination).toEqual({
      accountNumber: '1234567890',
      ifsc: 'HDFC0001234',
      accountHolderName: 'Payout Vendor',
    })
  })

  it('records payoutDestinationChangedAt on every change', async () => {
    // First set
    await executeUpdatePayoutMethod(db, 'u_payout_vendor', {
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'first@upi' },
    })

    const [first] = await db
      .select({ changedAt: vendorProfiles.payoutDestinationChangedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_payout_vendor'))

    const firstChangedAt = first.changedAt

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10))

    // Second set
    await executeUpdatePayoutMethod(db, 'u_payout_vendor', {
      payoutMethod: 'upi',
      payoutDestination: { vpa: 'second@upi' },
    })

    const [second] = await db
      .select({ changedAt: vendorProfiles.payoutDestinationChangedAt })
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, 'u_payout_vendor'))

    expect(second.changedAt).toBeInstanceOf(Date)
    // The second change should have a later timestamp
    expect(second.changedAt!.getTime()).toBeGreaterThanOrEqual(firstChangedAt!.getTime())
  })

  it('rejects UPI without vpa', async () => {
    const result = await executeUpdatePayoutMethod(
      db,
      'u_payout_vendor',
      {
        payoutMethod: 'upi',
        payoutDestination: {},
      },
    )

    expect(result.ok).toBe(false)
  })

  it('rejects bank_account without required fields', async () => {
    const result = await executeUpdatePayoutMethod(
      db,
      'u_payout_vendor',
      {
        payoutMethod: 'bank_account',
        payoutDestination: { accountNumber: '123' },
      },
    )

    expect(result.ok).toBe(false)
  })

  it('rejects invalid payout method', async () => {
    const result = await executeUpdatePayoutMethod(
      db,
      'u_payout_vendor',
      {
        payoutMethod: 'paypal' as 'upi',
        payoutDestination: { vpa: 'test@upi' },
      },
    )

    expect(result.ok).toBe(false)
  })
})
