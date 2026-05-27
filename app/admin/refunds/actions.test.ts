import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { availabilitySlots } from '@/db/schema/availability-slots'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { refundRequests } from '@/db/schema/refund-requests'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { walletBalances } from '@/db/schema/wallet-balances'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeApproveRefund,
  executeRejectRefund,
} from './actions'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAdmin(db: TestDB): Promise<string> {
  const adminId = 'admin_refund_1'
  await db.insert(users).values({ id: adminId, email: 'admin-refund@test.com' })
  return adminId
}

async function seedCustomer(db: TestDB, suffix = '1'): Promise<string> {
  const customerId = `customer_refund_${suffix}`
  await db.insert(users).values({ id: customerId, email: `customer-refund-${suffix}@test.com` })
  return customerId
}

async function seedVendor(db: TestDB): Promise<string> {
  const vendorId = 'vendor_refund_1'
  await db.insert(users).values({ id: vendorId, email: 'vendor-refund@test.com' })
  await db.insert(vendorProfiles).values({
    userId: vendorId,
    businessName: 'Refund Test Co',
    slug: 'refund-test-co',
    kycTier: 'identity',
    commissionRate: '20.00',
    manualPayoutsRemaining: 3,
  })
  return vendorId
}

async function seedBooking(
  db: TestDB,
  vendorId: string,
  customerId: string,
): Promise<string> {
  const expId = crypto.randomUUID()
  await db.insert(experiences).values({
    id: expId,
    vendorUserId: vendorId,
    slug: `exp-refund-${expId.slice(0, 8)}`,
    title: 'Refund Test Experience',
    status: 'published',
    cancellationPreset: 'moderate',
    paymentModesAllowed: ['full_upfront'],
    pricePerPerson_1_2: '2500.00',
    pricePerPerson_3_5: '2000.00',
    pricePerPerson_6_plus: '1800.00',
    regionSlug: 'rishikesh',
    activitySlug: 'rafting',
  })

  const slotId = crypto.randomUUID()
  await db.insert(availabilitySlots).values({
    id: slotId,
    experienceId: expId,
    startAt: new Date('2026-07-01T03:30:00Z'),
    endAt: new Date('2026-07-01T05:30:00Z'),
    capacity: 10,
    capacityTaken: 2,
  })

  const bookingId = crypto.randomUUID()
  await db.insert(bookings).values({
    id: bookingId,
    customerUserId: customerId,
    experienceId: expId,
    slotId,
    participantCount: 2,
    state: 'confirmed',
    paymentMode: 'full_upfront',
    grossTotalSnapshot: '5000.00',
    pricePerParticipantSnapshot: '2500.00',
    pricingBasisSnapshot: 'experience_bracket:1_2',
    commissionRateSnapshot: '20.00',
    commissionBasisSnapshot: 'vendor_default',
    cancellationPresetSnapshot: 'moderate',
    tdsAmountSnapshot: '50.00',
    gstRateOnCommissionSnapshot: '18.00',
  })

  return bookingId
}

async function seedRefundRequest(
  db: TestDB,
  bookingId: string,
  customerId: string,
  overrides: {
    amount?: string
    state?: 'pending' | 'approved' | 'credited' | 'rejected' | 'failed'
  } = {},
): Promise<string> {
  const refundId = crypto.randomUUID()
  await db.insert(refundRequests).values({
    id: refundId,
    bookingId,
    requestedByUserId: customerId,
    reason: 'inside_policy_cancellation',
    destination: 'refund_balance',
    state: overrides.state ?? 'pending',
    amount: overrides.amount ?? '5000.00',
    cancellationPresetSnapshot: 'moderate',
    policyWindowBasisSnapshot: 'free_window',
  })
  return refundId
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Admin refund processing actions', () => {
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
      sql`TRUNCATE TABLE audit_logs, wallet_balances, refund_requests, bookings, availability_slots, experiences, vendor_profiles, users CASCADE`,
    )
  })

  // ── Approve Full Amount ──────────────────────────────────────────

  describe('executeApproveRefund', () => {
    it('approves full amount: credits wallet, updates state to credited, creates audit log', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
      })

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: refundId,
        amount: 5000,
      })

      expect(result).toEqual({ ok: true })

      // Verify refund state transitioned to credited
      const [refund] = await db
        .select({ state: refundRequests.state })
        .from(refundRequests)
        .where(eq(refundRequests.id, refundId))
      expect(refund?.state).toBe('credited')

      // Verify wallet was credited
      const [wallet] = await db
        .select({ amount: walletBalances.amount })
        .from(walletBalances)
        .where(eq(walletBalances.userId, customerId))
      expect(Number(wallet?.amount)).toBe(5000)

      // Verify audit logs (wallet credit + admin approve)
      const logs = await db
        .select()
        .from(auditLogs)
        .orderBy(auditLogs.createdAt)
      // creditRefundBalance writes its own audit log, plus our admin action
      const adminLog = logs.find((l) => l.action === 'admin.refund.approve')
      expect(adminLog).toBeDefined()
      expect(adminLog?.actorUserId).toBe(adminId)
      expect(adminLog?.entityType).toBe('refund_request')
      expect(adminLog?.entityId).toBe(refundId)
      expect(adminLog?.payload).toMatchObject({
        previousState: 'pending',
        newState: 'credited',
        requestedAmountRupees: 5000,
        approvedAmountRupees: 5000,
        isPartial: false,
        bookingId,
        customerUserId: customerId,
      })
    })

    // ── Approve Partial Amount ────────────────────────────────────

    it('approves partial amount: credits partial, validates amount <= original', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
      })

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: refundId,
        amount: 2500,
      })

      expect(result).toEqual({ ok: true })

      // Verify wallet credited with partial amount
      const [wallet] = await db
        .select({ amount: walletBalances.amount })
        .from(walletBalances)
        .where(eq(walletBalances.userId, customerId))
      expect(Number(wallet?.amount)).toBe(2500)

      // Verify audit log records partial
      const logs = await db.select().from(auditLogs)
      const adminLog = logs.find((l) => l.action === 'admin.refund.approve')
      expect(adminLog?.payload).toMatchObject({
        isPartial: true,
        approvedAmountRupees: 2500,
        requestedAmountRupees: 5000,
      })

      // Verify notes record partial info
      const [refund] = await db
        .select({ notes: refundRequests.notes })
        .from(refundRequests)
        .where(eq(refundRequests.id, refundId))
      expect(refund?.notes).toContain('Partial refund')
    })

    // ── Amount exceeds requested ──────────────────────────────────

    it('rejects approval when amount exceeds requested amount', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
      })

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: refundId,
        amount: 6000,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('exceeds')
      }

      // Verify state unchanged
      const [refund] = await db
        .select({ state: refundRequests.state })
        .from(refundRequests)
        .where(eq(refundRequests.id, refundId))
      expect(refund?.state).toBe('pending')

      // Verify wallet NOT credited
      const wallets = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, customerId))
      expect(wallets).toHaveLength(0)
    })

    // ── Cannot approve already-approved/rejected ──────────────────

    it('cannot approve already-credited refund', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
        state: 'credited',
      })

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: refundId,
        amount: 5000,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('cannot approve already-rejected refund', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
        state: 'rejected',
      })

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: refundId,
        amount: 5000,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('returns error for non-existent refund request', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: '00000000-0000-0000-0000-000000000000',
        amount: 1000,
      })

      expect(result).toEqual({ ok: false, error: 'Refund request not found.' })
    })

    it('rejects zero amount', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: '00000000-0000-0000-0000-000000000000',
        amount: 0,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('positive')
      }
    })

    it('rejects negative amount', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: '00000000-0000-0000-0000-000000000000',
        amount: -100,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('positive')
      }
    })

    it('rejects fractional amount', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeApproveRefund(db, adminId, {
        refundRequestId: '00000000-0000-0000-0000-000000000000',
        amount: 100.5,
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('whole number')
      }
    })
  })

  // ── Reject Refund ───────────────────────────────────────────────

  describe('executeRejectRefund', () => {
    it('rejects refund: updates state with reason, does NOT credit wallet', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        amount: '5000.00',
      })

      const result = await executeRejectRefund(db, adminId, {
        refundRequestId: refundId,
        reason: 'Outside cancellation policy window',
      })

      expect(result).toEqual({ ok: true })

      // Verify state transitioned to rejected
      const [refund] = await db
        .select({ state: refundRequests.state, notes: refundRequests.notes })
        .from(refundRequests)
        .where(eq(refundRequests.id, refundId))
      expect(refund?.state).toBe('rejected')
      expect(refund?.notes).toBe('Outside cancellation policy window')

      // Verify wallet NOT credited
      const wallets = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, customerId))
      expect(wallets).toHaveLength(0)

      // Verify audit log
      const [log] = await db.select().from(auditLogs)
      expect(log?.action).toBe('admin.refund.reject')
      expect(log?.actorUserId).toBe(adminId)
      expect(log?.entityType).toBe('refund_request')
      expect(log?.entityId).toBe(refundId)
      expect(log?.payload).toMatchObject({
        previousState: 'pending',
        newState: 'rejected',
        reason: 'Outside cancellation policy window',
        bookingId,
        customerUserId: customerId,
      })
    })

    it('cannot reject already-credited refund', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        state: 'credited',
      })

      const result = await executeRejectRefund(db, adminId, {
        refundRequestId: refundId,
        reason: 'Too late',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('cannot reject already-rejected refund', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId, {
        state: 'rejected',
      })

      const result = await executeRejectRefund(db, adminId, {
        refundRequestId: refundId,
        reason: 'Double reject',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('pending')
      }
    })

    it('requires reason text (rejects empty string)', async () => {
      const adminId = await seedAdmin(db)
      const vendorId = await seedVendor(db)
      const customerId = await seedCustomer(db)
      const bookingId = await seedBooking(db, vendorId, customerId)
      const refundId = await seedRefundRequest(db, bookingId, customerId)

      const result = await executeRejectRefund(db, adminId, {
        refundRequestId: refundId,
        reason: '',
      })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain('Reason is required')
      }

      // State unchanged
      const [refund] = await db
        .select({ state: refundRequests.state })
        .from(refundRequests)
        .where(eq(refundRequests.id, refundId))
      expect(refund?.state).toBe('pending')
    })

    it('returns error for non-existent refund request', async () => {
      const adminId = await seedAdmin(db)

      const result = await executeRejectRefund(db, adminId, {
        refundRequestId: '00000000-0000-0000-0000-000000000000',
        reason: 'Invalid',
      })

      expect(result).toEqual({ ok: false, error: 'Refund request not found.' })
    })
  })
})
