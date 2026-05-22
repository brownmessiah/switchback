import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { writeAuditLog } from '@/lib/audit/write'
import { getRedis } from '@/lib/redis'

import { resolveCommission, type DBOrTx } from './commission-resolver'
import { GST_RATE_ON_COMMISSION } from './gst-calculator'
import { resolvePricing } from './pricing-resolver'
import { quoteTds } from './tds-calculator'

/**
 * Booking-create transaction — the load-bearing primitive every other
 * M2 feature builds on. See `lib/payments/booking-create.test.ts` for the
 * full set of invariants exercised against PGlite.
 *
 * Single db.transaction(...) — SELECT FOR UPDATE the slot, validate
 * permits + payment mode + capacity, resolve commission + pricing +
 * TDS + GST, decrement capacity, insert the booking row with all 12
 * snapshot columns populated, write the booking.create audit row.
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
  | 'VENDOR_PAYOUT_NOT_CONFIGURED'

export class BookingCreateError extends Error {
  constructor(
    public code: BookingCreateErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BookingCreateError'
  }
}

const PARTIAL_PAY_UNDER_HOURS = 48
const PARTIAL_PAY_ESCROW_THRESHOLD_RUPEES = 25_000

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

  const result = await db.transaction(async (tx) => {
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

    // 6. Resolve pricing chain — snapshotted on the row below.
    const pricing = await resolvePricing(tx, {
      experienceId: parsed.experienceId,
      participantCount: parsed.participantCount,
      now: slot.startAt,
    })
    const grossRupees = Math.floor(
      Number(pricing.pricePerParticipant) * parsed.participantCount,
    )

    // 7. Resolve commission chain — snapshotted on the row below.
    const commission = await resolveCommission(tx, {
      experienceId: parsed.experienceId,
    })

    // 8. TDS + GST. Residency proxy in v1: PAN IS NOT NULL → resident.
    // M3 KYC swaps in an explicit vendor_profiles.is_resident column.
    const vendorIsResident = vendor.pan !== null
    const tds = quoteTds({
      grossRupees,
      vendorIsResident,
      vendorPan: vendor.pan ?? null,
    })

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

    // 11. Insert Booking with all 12 snapshot columns populated.
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

  // 13. Idempotency cache after transaction commits.
  await redis.set(idempKey, `${result.bookingId}|${result.effectivePaymentMode}`, {
    ex: 24 * 60 * 60,
  })

  return result
}
