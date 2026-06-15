import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import { assertBookingWithinTier } from '@/lib/kyc/enforce-tier-caps'
import type { TierCapViolationCode } from '@/lib/kyc/tier-caps'
import { getRedis } from '@/lib/redis'

import { resolveCommission, type DBOrTx } from './commission-resolver'
import { GST_RATE_ON_COMMISSION } from './gst-calculator'
import { resolvePricing } from './pricing-resolver'
import { quoteTcs } from './tcs-calculator'
import { quoteTds } from './tds-calculator'

/**
 * Booking-create transaction — the load-bearing primitive every other
 * M2 feature builds on. See `lib/payments/booking-create.test.ts` for the
 * full set of invariants exercised against PGlite.
 *
 * Single db.transaction(...) — SELECT FOR UPDATE the slot, validate
 * permits + payment mode + capacity, resolve commission + pricing +
 * TDS + GST TCS + GST-on-commission, decrement capacity, insert the
 * booking row with all snapshot columns populated, write the audit row.
 * Rollback is atomic on any step's failure.
 *
 * Carve-outs for partial-pay per ADR-0001:
 *   - <48h before slot.startAt → effectivePaymentMode = 'full_upfront'
 *     (logged as `partial_pay_coerced_under_48h` in audit payload)
 *   - gross > Rs.25,000 → keep paymentMode='partial_pay' but stamp
 *     `captureTrigger='escrow_full_capture'` in the audit payload so
 *     the M3 capture worker knows to take 100% up front.
 *
 * RNPL (ADR-0002) is rejected with code RNPL_DEFERRED_TO_V2.
 *
 * Vendor residency is derived from `vendor.pan IS NOT NULL` in v1 —
 * the M3 KYC stack adds an explicit is_resident column. This sidesteps
 * the CRITICAL security finding that the TDS calculator throws on a
 * resident-without-PAN case: a vendor without PAN is treated as non-
 * resident here, the calculator's throw becomes dead code unreachable
 * from valid inputs.
 *
 * Idempotency: Redis key `booking-create:<idempotencyKey>` with 24h TTL.
 * Second call with the same key returns the cached bookingId + mode
 * without re-creating. In local dev the Redis stub returns null on
 * every GET, so idempotency is best-effort in dev — production-grade
 * once UPSTASH_REDIS_REST_URL is set.
 */

const InputSchema = z.object({
  customerUserId: z.string().min(1),
  experienceId: z.string().uuid(),
  slotId: z.string().uuid(),
  participantCount: z.number().int().positive().max(50),
  paymentMode: z.enum(['full_upfront', 'partial_pay', 'reserve_now_pay_later']),
  tripGroupId: z.string().uuid().nullable().optional(),
  acknowledgedPermits: z.boolean().optional().default(false),
  // ADR-0011 revision 2026-06-16 (issue #07): optional Customer-selected
  // pricing variation. A supplied id MUST be a valid, ACTIVE variation
  // belonging to this Experience — resolvePricing REJECTS an unknown / foreign
  // / inactive id (the transaction rolls back), never silently downgrading to
  // the tier/bracket chain. The resolved price flows into the SAME snapshot
  // columns, so the existing snapshot-immutability machinery protects it.
  variationId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid(),
})

export type BookingCreateInput = z.input<typeof InputSchema>

export type BookingCreateErrorCode =
  | 'RNPL_DEFERRED_TO_V2'
  | 'PAYMENT_MODE_NOT_ALLOWED'
  | 'PERMITS_NOT_ACKNOWLEDGED'
  | 'SLOT_CLOSED'
  | 'SLOT_SOLD_OUT'
  | 'INSUFFICIENT_CAPACITY'
  | 'EXPERIENCE_NOT_FOUND'
  | 'VENDOR_NOT_FOUND'
  | 'VENDOR_SUSPENDED'
  | 'VENDOR_PAYOUT_NOT_CONFIGURED'
  | 'TIER_CAP_EXCEEDED'

export class BookingCreateError extends Error {
  /**
   * For TIER_CAP_EXCEEDED, the underlying ADR-0007 violation code so the
   * top-level handler can write a rejection audit row that survives the
   * rolled-back booking transaction.
   */
  public tierCapViolationCode?: TierCapViolationCode

  constructor(
    public code: BookingCreateErrorCode,
    message: string,
    tierCapViolationCode?: TierCapViolationCode,
  ) {
    super(message)
    this.name = 'BookingCreateError'
    this.tierCapViolationCode = tierCapViolationCode
  }
}

const PARTIAL_PAY_UNDER_HOURS = 48
const PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES = 25_000

/**
 * Start of the Indian financial year (1 April, 00:00 UTC) for the FY that
 * contains `now`. Bounds the Section 194-O(2) ₹5L FY-cumulative gross. UTC is
 * a documented approximation of the IST boundary (immaterial except within
 * ~5.5h of 1 April midnight IST) — see ADR-0016.
 */
function indianFinancialYearStartUtc(now: Date): Date {
  const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return new Date(Date.UTC(year, 3, 1, 0, 0, 0))
}

export interface BookingCreateResult {
  bookingId: string
  effectivePaymentMode: 'full_upfront' | 'partial_pay'
}

export async function createBooking(
  db: DBOrTx,
  input: BookingCreateInput,
): Promise<BookingCreateResult> {
  const parsed = InputSchema.parse(input)

  // 1. Reject RNPL up front before any DB work (ADR-0002).
  if (parsed.paymentMode === 'reserve_now_pay_later') {
    throw new BookingCreateError(
      'RNPL_DEFERRED_TO_V2',
      'Reserve-now-pay-later is reserved in the schema but not implemented in v1',
    )
  }

  // 2. Idempotency lookup (outside the transaction — Redis only).
  const redis = getRedis()
  const idempKey = `booking-create:${parsed.idempotencyKey}`
  const cached = await redis.get(idempKey)
  if (cached !== null && typeof cached === 'string') {
    const [existingId, existingMode] = cached.split('|')
    if (existingId && existingMode) {
      return {
        bookingId: existingId,
        effectivePaymentMode: existingMode as 'full_upfront' | 'partial_pay',
      }
    }
  }

  let result: BookingCreateResult
  try {
    result = await db.transaction(async (tx) => {
    // 3. SELECT FOR UPDATE on the slot — serialises concurrent attempts.
    const [slot] = await tx
      .select()
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, parsed.slotId))
      .for('update')
      .limit(1)

    if (!slot) {
      throw new BookingCreateError('SLOT_CLOSED', `slot ${parsed.slotId} not found`)
    }
    if (slot.status === 'closed') {
      throw new BookingCreateError('SLOT_CLOSED', 'slot is closed')
    }
    if (slot.status === 'sold_out') {
      throw new BookingCreateError('SLOT_SOLD_OUT', 'slot is sold out')
    }
    if (slot.capacityTaken + parsed.participantCount > slot.capacity) {
      throw new BookingCreateError(
        'INSUFFICIENT_CAPACITY',
        `slot has ${slot.capacity - slot.capacityTaken} seats remaining; ${parsed.participantCount} requested`,
      )
    }

    // 4. Load Experience and verify payment mode + permit acknowledgement.
    const [exp] = await tx
      .select()
      .from(experiences)
      .where(eq(experiences.id, parsed.experienceId))
      .limit(1)
    if (!exp) {
      throw new BookingCreateError(
        'EXPERIENCE_NOT_FOUND',
        `experience ${parsed.experienceId} not found`,
      )
    }
    if (!exp.paymentModesAllowed.includes(parsed.paymentMode)) {
      throw new BookingCreateError(
        'PAYMENT_MODE_NOT_ALLOWED',
        `payment mode ${parsed.paymentMode} not allowed for this Experience`,
      )
    }
    if (exp.requiredPermits.length > 0 && !parsed.acknowledgedPermits) {
      throw new BookingCreateError(
        'PERMITS_NOT_ACKNOWLEDGED',
        'this Experience requires permits; the Customer must acknowledge them before booking',
      )
    }

    // 5. Load Vendor for payout + PAN snapshots.
    const [vendor] = await tx
      .select()
      .from(vendorProfiles)
      .where(eq(vendorProfiles.userId, exp.vendorUserId))
      .limit(1)
    if (!vendor) {
      throw new BookingCreateError(
        'VENDOR_NOT_FOUND',
        `vendor ${exp.vendorUserId} not found`,
      )
    }

    // 5a. Admin suspension gate (vendor_profiles.suspended). A Vendor an admin
    // has suspended cannot accept new Bookings — the flag is re-checked here
    // because the Experience may have been published before the suspension.
    // Refusal rolls back the whole transaction atomically.
    if (vendor.suspended) {
      throw new BookingCreateError(
        'VENDOR_SUSPENDED',
        `vendor ${exp.vendorUserId} is suspended and cannot accept new bookings`,
      )
    }

    // 5b. ADR-0007 Tier-2 cap re-check. The Vendor's KYC tier may have been
    // downgraded after the Experience was published, so the caps are
    // double-checked here against the CURRENT tier + the booked slot. An
    // over-cap Booking is refused; the rollback is atomic. The rejection
    // audit row is written by the top-level handler so it survives.
    const tierCheck = await assertBookingWithinTier(tx, parsed.experienceId, {
      startAt: slot.startAt,
      endAt: slot.endAt,
      capacity: slot.capacity,
    })
    if (!tierCheck.ok) {
      throw new BookingCreateError(
        'TIER_CAP_EXCEEDED',
        tierCheck.reason,
        tierCheck.code,
      )
    }

    // 6. Resolve pricing chain — snapshotted on the row below. A supplied
    // variationId is arm 0 (top precedence, ADR-0011 revision 2026-06-16): an
    // invalid one throws here, rolling back the whole transaction (no booking,
    // no capacity decrement).
    const pricing = await resolvePricing(tx, {
      experienceId: parsed.experienceId,
      participantCount: parsed.participantCount,
      now: slot.startAt,
      variationId: parsed.variationId,
    })
    const grossRupees = Math.floor(
      Number(pricing.pricePerParticipant) * parsed.participantCount,
    )

    // 7. Resolve commission chain — snapshotted on the row below.
    const commission = await resolveCommission(tx, {
      experienceId: parsed.experienceId,
    })

    // 8. Tax: TDS u/s 194-O + GST TCS u/s Section 52. Residency proxy in v1:
    // PAN IS NOT NULL → resident. M3 KYC swaps in an explicit is_resident column.
    const vendorIsResident = vendor.pan !== null

    // Section 194-O(2) ₹5L threshold exemption applies only to individual/HUF
    // Vendors — compute the FY-cumulative gross (prior bookings this FY + this
    // one) only when the Vendor could qualify, otherwise skip the query.
    // NOTE (ADR-0016 / .scratch/tax-compliance-gaps): the FY-gross base counts
    // ALL of the Vendor's bookings in the FY regardless of state — the
    // conservative read (favours deducting). Exact base pending CA confirmation.
    let vendorFyGrossRupees: number | undefined
    if (vendor.taxpayerType === 'individual' || vendor.taxpayerType === 'huf') {
      const fyStart = indianFinancialYearStartUtc(new Date())
      const [agg] = await tx
        .select({
          priorGross: sql<string>`coalesce(sum(${bookings.grossTotalSnapshot}), 0)`,
        })
        .from(bookings)
        .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
        .where(
          and(eq(experiences.vendorUserId, vendor.userId), gte(bookings.confirmedAt, fyStart)),
        )
      vendorFyGrossRupees = Math.floor(Number(agg?.priorGross ?? 0)) + grossRupees
    }

    const tds = quoteTds({
      grossRupees,
      vendorIsResident,
      vendorPan: vendor.pan ?? null,
      vendorTaxpayerType: vendor.taxpayerType ?? undefined,
      vendorFyGrossRupees,
    })

    // GST TCS on the Vendor's supply value. Base = booking gross in v1 (the
    // Vendor's price); the exact net-of-GST/returns base is pending CA
    // confirmation per ADR-0016 / .scratch/tax-compliance-gaps.
    const tcs = quoteTcs({ taxableValueRupees: grossRupees })

    // 9. Determine effective payment mode + audit capture trigger label
    // per ADR-0001 carve-outs. RNPL was rejected at the function entry,
    // so the remaining options are full_upfront and partial_pay.
    const requestedMode: 'full_upfront' | 'partial_pay' =
      parsed.paymentMode === 'partial_pay' ? 'partial_pay' : 'full_upfront'
    const hoursToStart = (slot.startAt.getTime() - Date.now()) / 3_600_000
    let effectivePaymentMode: 'full_upfront' | 'partial_pay' = requestedMode
    let captureTriggerAuditLabel: 'booking_create' | 'escrow_full_capture' =
      'booking_create'
    let coercedUnder48h = false
    if (requestedMode === 'partial_pay' && hoursToStart < PARTIAL_PAY_UNDER_HOURS) {
      effectivePaymentMode = 'full_upfront'
      coercedUnder48h = true
    } else if (
      requestedMode === 'partial_pay' &&
      grossRupees > PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES
    ) {
      effectivePaymentMode = 'partial_pay'
      captureTriggerAuditLabel = 'escrow_full_capture'
    }

    // 10. Capacity decrement.
    const newCapacityTaken = slot.capacityTaken + parsed.participantCount
    await tx
      .update(availabilitySlots)
      .set({
        capacityTaken: newCapacityTaken,
        status: newCapacityTaken === slot.capacity ? 'sold_out' : slot.status,
        updatedAt: sql`now()`,
      })
      .where(eq(availabilitySlots.id, parsed.slotId))

    // 11. Insert Booking with all snapshot columns populated.
    const [booking] = await tx
      .insert(bookings)
      .values({
        customerUserId: parsed.customerUserId,
        experienceId: parsed.experienceId,
        slotId: parsed.slotId,
        participantCount: parsed.participantCount,
        paymentMode: effectivePaymentMode,
        state: 'confirmed',
        grossTotalSnapshot: grossRupees.toFixed(2),
        pricePerParticipantSnapshot: pricing.pricePerParticipant,
        pricingBasisSnapshot: pricing.basis,
        commissionRateSnapshot: commission.rate,
        commissionBasisSnapshot: commission.basis,
        cancellationPresetSnapshot: exp.cancellationPreset,
        tdsAmountSnapshot: tds.tdsRupees.toFixed(2),
        tcsAmountSnapshot: tcs.tcsRupees.toFixed(2),
        tcsRateSnapshot: tcs.tcsRatePercent,
        gstRateOnCommissionSnapshot: GST_RATE_ON_COMMISSION,
        vendorPanSnapshot: vendor.pan,
        vendorIsResidentSnapshot: vendorIsResident,
        payoutMethodSnapshot: vendor.payoutMethod ?? null,
        payoutDestinationSnapshot: vendor.payoutDestination ?? null,
        tripGroupId: parsed.tripGroupId ?? null,
      })
      .returning({ id: bookings.id })

    if (!booking) {
      throw new Error('booking insert returned no row (unreachable under .returning)')
    }

    // 12. Audit log row in the same transaction.
    await writeAuditLog(tx, {
      actorUserId: parsed.customerUserId,
      action: 'booking.create',
      entityType: 'booking',
      entityId: booking.id,
      payload: {
        experienceId: parsed.experienceId,
        slotId: parsed.slotId,
        participantCount: parsed.participantCount,
        grossRupees,
        pricePerParticipantSnapshot: pricing.pricePerParticipant,
        pricingBasisSnapshot: pricing.basis,
        commissionRateSnapshot: commission.rate,
        commissionBasisSnapshot: commission.basis,
        tdsRupees: tds.tdsRupees,
        tdsBasis: tds.basis,
        tcsRupees: tcs.tcsRupees,
        tcsRatePercent: tcs.tcsRatePercent,
        gstRateOnCommissionSnapshot: GST_RATE_ON_COMMISSION,
        cancellationPresetSnapshot: exp.cancellationPreset,
        requestedPaymentMode: parsed.paymentMode,
        effectivePaymentMode,
        captureTrigger: captureTriggerAuditLabel,
        coercedUnder48h,
        acknowledgedPermits: parsed.acknowledgedPermits,
        tripGroupId: parsed.tripGroupId ?? null,
        idempotencyKey: parsed.idempotencyKey,
      },
    })

    return { bookingId: booking.id, effectivePaymentMode }
    })
  } catch (err: unknown) {
    // ADR-0007: a Tier-2 cap rejection rolls back the booking transaction.
    // Record the rejection in an audit row using the top-level db handle so
    // it survives the rollback (the transaction's own writes did not commit).
    if (err instanceof BookingCreateError && err.code === 'TIER_CAP_EXCEEDED') {
      const [exp] = await db
        .select({ vendorUserId: experiences.vendorUserId })
        .from(experiences)
        .where(eq(experiences.id, parsed.experienceId))
        .limit(1)
      const [vendor] = exp
        ? await db
            .select({ kycTier: vendorProfiles.kycTier })
            .from(vendorProfiles)
            .where(eq(vendorProfiles.userId, exp.vendorUserId))
            .limit(1)
        : []
      await writeAuditLog(db, {
        actorUserId: parsed.customerUserId,
        action: 'booking.tier_cap_rejected',
        entityType: 'experience',
        entityId: parsed.experienceId,
        payload: {
          code: err.tierCapViolationCode ?? null,
          reason: err.message,
          kycTier: vendor?.kycTier ?? null,
          slotId: parsed.slotId,
          participantCount: parsed.participantCount,
        },
      })
    }
    throw err
  }

  // 13. Idempotency cache after transaction commits.
  await redis.set(idempKey, `${result.bookingId}|${result.effectivePaymentMode}`, {
    ex: 24 * 60 * 60,
  })

  return result
}
