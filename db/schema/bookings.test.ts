import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { availabilitySlots } from './availability-slots'
import { bookings } from './bookings'
import { commissionTiers } from './commission-tiers'
import { experiences } from './experiences'
import { payments } from './payments'
import { pricingTiers } from './pricing-tiers'
import { refundRequests } from './refund-requests'
import { users } from './users'
import { vendorProfiles } from './vendor-profiles'

describe('money-path schema: bookings + payments + commission/pricing tiers (ADRs 0001/0003/0005/0008/0011/0016)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let slotId: string

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed Vendor + Experience + Slot used by every test.
    await db.insert(users).values([
      { id: 'u_v', email: 'v@example.com' },
      { id: 'u_c', email: 'c@example.com' },
      { id: 'u_admin', email: 'admin@example.com' },
    ])
    await db.insert(vendorProfiles).values({
      userId: 'u_v',
      businessName: 'Test Adventures',
      slug: 'test-adventures',
    })
    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_v',
        slug: 'rafting-day',
        title: 'Rafting Day',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront', 'partial_pay'],
        pricePerPerson_1_2: '1500',
        pricePerPerson_3_5: '1300',
        pricePerPerson_6_plus: '1100',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const [slot] = await db
      .insert(availabilitySlots)
      .values({
        experienceId,
        startAt: new Date('2026-09-15T08:00:00Z'),
        endAt: new Date('2026-09-15T12:00:00Z'),
        capacity: 8,
      })
      .returning({ id: availabilitySlots.id })
    slotId = slot!.id
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE payments, refund_requests, bookings, commission_tiers, pricing_tiers`,
    )
  })

  function baseBooking(): typeof bookings.$inferInsert {
    return {
      customerUserId: 'u_c',
      experienceId,
      slotId,
      participantCount: 2,
      paymentMode: 'partial_pay',
      grossTotalSnapshot: '3000.00',
      pricePerParticipantSnapshot: '1500.00',
      pricingBasisSnapshot: 'experience_tier_1_2',
      commissionRateSnapshot: '20.00',
      commissionBasisSnapshot: 'vendor_default',
      cancellationPresetSnapshot: 'flexible',
      tdsAmountSnapshot: '30.00',
    }
  }

  describe('bookings (ADR-0001, ADR-0003, ADR-0008, ADR-0011, ADR-0016)', () => {
    it('inserts a Booking with all snapshot fields populated', async () => {
      await db.insert(bookings).values(baseBooking())
      const [row] = await db.select().from(bookings)
      expect(row?.state).toBe('confirmed')
      expect(row?.autoCompleted).toBe(false)
      expect(row?.grossTotalSnapshot).toBe('3000.00')
      expect(row?.commissionRateSnapshot).toBe('20.00')
      expect(row?.commissionBasisSnapshot).toBe('vendor_default')
      expect(row?.cancellationPresetSnapshot).toBe('flexible')
      expect(row?.tdsAmountSnapshot).toBe('30.00')
      expect(row?.tripGroupId).toBeNull()
    })

    it('accepts every booking_state enum value', async () => {
      const states = [
        'confirmed',
        'awaiting_completion',
        'completed',
        'disputed',
        'cancelled_by_customer',
        'cancelled_by_vendor',
        'cancelled_post_experience',
      ] as const

      for (const state of states) {
        const [row] = await db
          .insert(bookings)
          .values({ ...baseBooking(), state })
          .returning({ state: bookings.state })
        expect(row?.state).toBe(state)
        await db.execute(sql`TRUNCATE TABLE bookings CASCADE`)
      }
    })

    it('rejects unknown booking_state values', async () => {
      await expect(
        db.execute(
          sql`INSERT INTO bookings (customer_user_id, experience_id, slot_id, participant_count, payment_mode, gross_total_snapshot, price_per_participant_snapshot, pricing_basis_snapshot, commission_rate_snapshot, commission_basis_snapshot, cancellation_preset_snapshot, state)
              VALUES ('u_c', ${experienceId}, ${slotId}, 2, 'full_upfront', 100, 50, 'x', 20, 'x', 'flexible', 'closed')`,
        ),
      ).rejects.toThrow()
    })

    it('accepts all three payment_mode values including reserve_now_pay_later (ADR-0002)', async () => {
      const modes = ['full_upfront', 'partial_pay', 'reserve_now_pay_later'] as const
      for (const mode of modes) {
        const [row] = await db
          .insert(bookings)
          .values({ ...baseBooking(), paymentMode: mode })
          .returning({ paymentMode: bookings.paymentMode })
        expect(row?.paymentMode).toBe(mode)
        await db.execute(sql`TRUNCATE TABLE bookings CASCADE`)
      }
    })

    it('rejects negative participant_count', async () => {
      await expect(
        db.insert(bookings).values({ ...baseBooking(), participantCount: -1 }),
      ).rejects.toThrow()
    })

    it('rejects zero participant_count', async () => {
      await expect(
        db.insert(bookings).values({ ...baseBooking(), participantCount: 0 }),
      ).rejects.toThrow()
    })

    it('rejects negative gross_total_snapshot', async () => {
      await expect(
        db.insert(bookings).values({ ...baseBooking(), grossTotalSnapshot: '-1.00' }),
      ).rejects.toThrow()
    })

    it('rejects commission_rate outside 0..100', async () => {
      await expect(
        db.insert(bookings).values({ ...baseBooking(), commissionRateSnapshot: '120.00' }),
      ).rejects.toThrow()
      await expect(
        db.insert(bookings).values({ ...baseBooking(), commissionRateSnapshot: '-5.00' }),
      ).rejects.toThrow()
    })

    it('rejects negative tds_amount_snapshot', async () => {
      await expect(
        db.insert(bookings).values({ ...baseBooking(), tdsAmountSnapshot: '-1.00' }),
      ).rejects.toThrow()
    })

    it('defaults gst_rate_on_commission_snapshot to 18.00 (ADR-0016)', async () => {
      await db.insert(bookings).values(baseBooking())
      const [row] = await db.select().from(bookings)
      expect(row?.gstRateOnCommissionSnapshot).toBe('18.00')
    })

    it('rejects gst_rate_on_commission_snapshot outside 0..100', async () => {
      await expect(
        db
          .insert(bookings)
          .values({ ...baseBooking(), gstRateOnCommissionSnapshot: '120.00' }),
      ).rejects.toThrow()
      await expect(
        db
          .insert(bookings)
          .values({ ...baseBooking(), gstRateOnCommissionSnapshot: '-1.00' }),
      ).rejects.toThrow()
    })

    it('persists vendor_pan_snapshot and defaults vendor_is_resident_snapshot to true (ADR-0016)', async () => {
      await db.insert(bookings).values({
        ...baseBooking(),
        vendorPanSnapshot: 'ABCDE1234F',
      })
      const [row] = await db.select().from(bookings)
      expect(row?.vendorPanSnapshot).toBe('ABCDE1234F')
      expect(row?.vendorIsResidentSnapshot).toBe(true)
    })

    it('accepts a non-resident Vendor booking with NULL PAN', async () => {
      await db.insert(bookings).values({
        ...baseBooking(),
        vendorPanSnapshot: null,
        vendorIsResidentSnapshot: false,
        tdsAmountSnapshot: '0.00', // Section 194-O TDS not applicable
      })
      const [row] = await db.select().from(bookings)
      expect(row?.vendorIsResidentSnapshot).toBe(false)
      expect(row?.vendorPanSnapshot).toBeNull()
    })

    it('defaults tds_amount_snapshot to 0.00 when not provided', async () => {
      await db.insert(bookings).values({
        customerUserId: 'u_c',
        experienceId,
        slotId,
        participantCount: 2,
        paymentMode: 'full_upfront',
        grossTotalSnapshot: '3000.00',
        pricePerParticipantSnapshot: '1500.00',
        pricingBasisSnapshot: 'experience_tier_1_2',
        commissionRateSnapshot: '20.00',
        commissionBasisSnapshot: 'vendor_default',
        cancellationPresetSnapshot: 'flexible',
      })
      const [row] = await db.select().from(bookings)
      expect(row?.tdsAmountSnapshot).toBe('0.00')
    })

    it('defaults payout_method_snapshot and payout_destination_snapshot to NULL (ADR-0016)', async () => {
      await db.insert(bookings).values(baseBooking())
      const [row] = await db.select().from(bookings)
      expect(row?.payoutMethodSnapshot).toBeNull()
      expect(row?.payoutDestinationSnapshot).toBeNull()
    })

    it('persists both payout snapshot columns when set together (ADR-0016)', async () => {
      await db.insert(bookings).values({
        ...baseBooking(),
        payoutMethodSnapshot: 'upi',
        payoutDestinationSnapshot: { vpa: 'vendor@upi' },
      })
      const [row] = await db.select().from(bookings)
      expect(row?.payoutMethodSnapshot).toBe('upi')
      expect(row?.payoutDestinationSnapshot).toEqual({ vpa: 'vendor@upi' })
    })

    it('accepts bank_account payout snapshot with destination JSON (ADR-0016)', async () => {
      await db.insert(bookings).values({
        ...baseBooking(),
        payoutMethodSnapshot: 'bank_account',
        payoutDestinationSnapshot: {
          accountHolder: 'Test Adventures',
          ifsc: 'HDFC0000123',
          accountNumber: '1234567890',
        },
      })
      const [row] = await db.select().from(bookings)
      expect(row?.payoutMethodSnapshot).toBe('bank_account')
      expect(
        (row?.payoutDestinationSnapshot as { ifsc: string })?.ifsc,
      ).toBe('HDFC0000123')
    })

    it('rejects payout_method_snapshot set with NULL destination (ADR-0016 consistency)', async () => {
      await expect(
        db.insert(bookings).values({
          ...baseBooking(),
          payoutMethodSnapshot: 'upi',
          payoutDestinationSnapshot: null,
        }),
      ).rejects.toThrow()
    })

    it('rejects payout_destination_snapshot set with NULL method (ADR-0016 consistency)', async () => {
      await expect(
        db.insert(bookings).values({
          ...baseBooking(),
          payoutMethodSnapshot: null,
          payoutDestinationSnapshot: { vpa: 'orphan@upi' },
        }),
      ).rejects.toThrow()
    })

    it('restricts deletion of a User who has Bookings', async () => {
      await db.insert(bookings).values(baseBooking())
      await expect(db.delete(users).where(eq(users.id, 'u_c'))).rejects.toThrow()
    })

    it('restricts deletion of an Experience that has Bookings', async () => {
      await db.insert(bookings).values(baseBooking())
      await expect(
        db.delete(experiences).where(eq(experiences.id, experienceId)),
      ).rejects.toThrow()
    })

    it('restricts deletion of a Slot that has Bookings', async () => {
      await db.insert(bookings).values(baseBooking())
      await expect(
        db.delete(availabilitySlots).where(eq(availabilitySlots.id, slotId)),
      ).rejects.toThrow()
    })
  })

  describe('payments (ADR-0001)', () => {
    let bookingId: string

    beforeEach(async () => {
      const [b] = await db.insert(bookings).values(baseBooking()).returning({ id: bookings.id })
      bookingId = b!.id
    })

    it('inserts a positive booking_create payment with all capture triggers', async () => {
      const triggers = [
        'booking_create',
        'auto_capture_t_minus_24h',
        'escrow_full_capture',
        'manual_admin',
      ] as const
      for (const [i, trigger] of triggers.entries()) {
        await db.insert(payments).values({
          bookingId,
          razorpayPaymentId: `pay_${trigger}_${i}`,
          amount: '500.00',
          captureTrigger: trigger,
        })
      }
      const rows = await db.select().from(payments)
      expect(rows).toHaveLength(4)
    })

    it('accepts refund_reverse only with a negative amount', async () => {
      // Refund-reverse payments require a refund_requests row (ADR-0004/0005);
      // seed one so the CHECK is satisfied.
      const [refundRequest] = await db
        .insert(refundRequests)
        .values({
          bookingId,
          requestedByUserId: 'u_c',
          reason: 'inside_policy_cancellation',
          destination: 'refund_balance',
          amount: '500.00',
          cancellationPresetSnapshot: 'flexible',
          policyWindowBasisSnapshot: '50%_window',
          state: 'approved',
        })
        .returning({ id: refundRequests.id })

      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_refund_positive',
          amount: '500.00',
          captureTrigger: 'refund_reverse',
          refundRequestId: refundRequest!.id,
        }),
      ).rejects.toThrow()

      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_refund_negative',
        amount: '-500.00',
        captureTrigger: 'refund_reverse',
        refundRequestId: refundRequest!.id,
      })
      const rows = await db.select().from(payments)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.amount).toBe('-500.00')
    })

    it('rejects non-refund captures with non-positive amount', async () => {
      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_zero',
          amount: '0.00',
          captureTrigger: 'booking_create',
        }),
      ).rejects.toThrow()

      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_neg',
          amount: '-1.00',
          captureTrigger: 'booking_create',
        }),
      ).rejects.toThrow()
    })

    it('enforces razorpay_payment_id uniqueness (idempotency floor)', async () => {
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_idem',
        amount: '500',
        captureTrigger: 'booking_create',
      })
      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_idem',
          amount: '750',
          captureTrigger: 'auto_capture_t_minus_24h',
        }),
      ).rejects.toThrow()
    })

    it('enforces razorpay_order_id partial-unique (skips NULLs, blocks duplicates)', async () => {
      // Two NULL rows allowed (M1 mostly captures via payment_id, order_id often NULL).
      await db.insert(payments).values([
        {
          bookingId,
          razorpayPaymentId: 'pay_null_1',
          amount: '500',
          captureTrigger: 'booking_create',
        },
        {
          bookingId,
          razorpayPaymentId: 'pay_null_2',
          amount: '500',
          captureTrigger: 'auto_capture_t_minus_24h',
        },
      ])
      // Same non-null order_id is rejected.
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_with_order',
        razorpayOrderId: 'order_xyz',
        amount: '500',
        captureTrigger: 'booking_create',
      })
      await expect(
        db.insert(payments).values({
          bookingId,
          razorpayPaymentId: 'pay_with_order_dup',
          razorpayOrderId: 'order_xyz',
          amount: '500',
          captureTrigger: 'auto_capture_t_minus_24h',
        }),
      ).rejects.toThrow()
    })

    it('restricts deletion of a Booking that has Payments', async () => {
      await db.insert(payments).values({
        bookingId,
        razorpayPaymentId: 'pay_restrict',
        amount: '500',
        captureTrigger: 'booking_create',
      })
      await expect(db.delete(bookings).where(eq(bookings.id, bookingId))).rejects.toThrow()
    })
  })

  describe('commission_tiers (ADR-0008)', () => {
    it('persists empty applies_to arrays meaning all-scope', async () => {
      await db.insert(commissionTiers).values({
        name: 'festival_diwali_2026',
        startAt: new Date('2026-11-01T00:00:00Z'),
        endAt: new Date('2026-11-08T23:59:59Z'),
        rateOverride: '15.00',
        reason: 'Diwali festival bonus',
        createdByAdminUserId: 'u_admin',
      })
      const [row] = await db.select().from(commissionTiers)
      expect(row?.appliesToCategories).toEqual([])
      expect(row?.appliesToVendorIds).toEqual([])
      expect(row?.appliesToExperienceIds).toEqual([])
      expect(row?.rateOverride).toBe('15.00')
    })

    it('rejects end_at <= start_at', async () => {
      await expect(
        db.insert(commissionTiers).values({
          name: 'bad',
          startAt: new Date('2026-11-02T00:00:00Z'),
          endAt: new Date('2026-11-01T00:00:00Z'),
          rateOverride: '15.00',
          reason: 'bad',
          createdByAdminUserId: 'u_admin',
        }),
      ).rejects.toThrow()
    })

    it('rejects rate_override outside 0..100', async () => {
      await expect(
        db.insert(commissionTiers).values({
          name: 'over',
          startAt: new Date('2026-11-01T00:00:00Z'),
          endAt: new Date('2026-11-08T23:59:59Z'),
          rateOverride: '150.00',
          reason: 'bad',
          createdByAdminUserId: 'u_admin',
        }),
      ).rejects.toThrow()
    })

    it('stores narrow-scoped applies_to arrays', async () => {
      await db.insert(commissionTiers).values({
        name: 'combo_default',
        startAt: new Date('2026-01-01T00:00:00Z'),
        endAt: new Date('2030-12-31T23:59:59Z'),
        appliesToCategories: ['rafting', 'paragliding'],
        appliesToVendorIds: ['u_v'],
        appliesToExperienceIds: [],
        rateOverride: '30.00',
        reason: 'Combo Experience default',
        createdByAdminUserId: 'u_admin',
      })
      const [row] = await db.select().from(commissionTiers)
      expect(row?.appliesToCategories).toEqual(['rafting', 'paragliding'])
      expect(row?.appliesToVendorIds).toEqual(['u_v'])
    })

    it('rejects malformed uuid values in applies_to_experience_ids (uuid[] not text[])', async () => {
      await expect(
        db.insert(commissionTiers).values({
          name: 'bad',
          startAt: new Date('2026-01-01T00:00:00Z'),
          endAt: new Date('2026-12-31T23:59:59Z'),
          appliesToCategories: [],
          appliesToVendorIds: [],
          // Runtime rejection — Postgres uuid[] rejects malformed values
          // at INSERT time even though TS accepts string[].
          appliesToExperienceIds: ['not-a-uuid'],
          rateOverride: '20',
          reason: 'bad',
          createdByAdminUserId: 'u_admin',
        }),
      ).rejects.toThrow()
    })
  })

  describe('pricing_tiers (ADR-0011)', () => {
    it('persists a price override with applies_to filters', async () => {
      await db.insert(pricingTiers).values({
        name: 'monsoon_special_2026',
        startAt: new Date('2026-06-01T00:00:00Z'),
        endAt: new Date('2026-06-30T23:59:59Z'),
        appliesToCategories: ['rafting'],
        appliesToVendorIds: [],
        appliesToExperienceIds: [],
        pricePerPersonOverride: '999.00',
        reason: 'Monsoon promo',
        createdByAdminUserId: 'u_admin',
      })
      const [row] = await db.select().from(pricingTiers)
      expect(row?.pricePerPersonOverride).toBe('999.00')
    })

    it('rejects negative price_per_person_override', async () => {
      await expect(
        db.insert(pricingTiers).values({
          name: 'bad',
          startAt: new Date('2026-06-01T00:00:00Z'),
          endAt: new Date('2026-06-30T23:59:59Z'),
          pricePerPersonOverride: '-100',
          reason: 'bad',
          createdByAdminUserId: 'u_admin',
        }),
      ).rejects.toThrow()
    })

    it('rejects end_at <= start_at', async () => {
      await expect(
        db.insert(pricingTiers).values({
          name: 'bad',
          startAt: new Date('2026-06-02T00:00:00Z'),
          endAt: new Date('2026-06-01T00:00:00Z'),
          pricePerPersonOverride: '100',
          reason: 'bad',
          createdByAdminUserId: 'u_admin',
        }),
      ).rejects.toThrow()
    })
  })
})
