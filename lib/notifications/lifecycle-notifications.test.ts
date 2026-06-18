import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { notificationOutbox } from '@/db/schema/notification-outbox'
import { notificationPreferences } from '@/db/schema/notification-preferences'
import { notifications } from '@/db/schema/notifications'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  notifyBookingConfirmed,
  notifyRefundCredited,
  notifyPayoutStateChange,
} from './booking-events'

/**
 * Lifecycle notification helpers — the post-commit, fire-and-forget
 * notify() wiring for the booking/cancel/refund/payout money path.
 *
 * Each helper must:
 *  - write a notifications row for the RIGHT userId with the RIGHT type
 *    + link,
 *  - be idempotent via eventId (call twice → exactly one row),
 *  - inherit notify()'s preference-aware fan-out (a disabled channel ⇒
 *    that channel's outbox row is `skipped`).
 */
describe('lifecycle notification helpers', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  const customerId = 'u_customer_lifecycle'
  const vendorId = 'u_vendor_lifecycle'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: customerId, email: 'customer-lifecycle@test.com' },
      { id: vendorId, email: 'vendor-lifecycle@test.com' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE notification_outbox CASCADE`)
    await db.execute(sql`TRUNCATE TABLE notifications CASCADE`)
    await db.execute(sql`TRUNCATE TABLE notification_preferences CASCADE`)
  })

  // ── notifyBookingConfirmed (→ customer) ────────────────────────────
  describe('notifyBookingConfirmed', () => {
    it('creates a notification for the customer with the confirmation link', async () => {
      const result = await notifyBookingConfirmed(db, {
        bookingId: 'b_conf_1',
        experienceTitle: 'Rishikesh Rafting',
        customerUserId: customerId,
      })

      expect(result.created).toBe(true)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe(customerId)
      expect(rows[0]!.type).toBe('booking_created')
      expect(rows[0]!.link).toBe('/bookings/b_conf_1/confirmation')
    })

    it('is idempotent for the same booking', async () => {
      const args = {
        bookingId: 'b_conf_dup',
        experienceTitle: 'Rishikesh Rafting',
        customerUserId: customerId,
      }
      const first = await notifyBookingConfirmed(db, args)
      const second = await notifyBookingConfirmed(db, args)

      expect(first.created).toBe(true)
      expect(second.created).toBe(false)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
    })
  })

  // ── notifyRefundCredited (→ customer) ──────────────────────────────
  describe('notifyRefundCredited', () => {
    it('creates a notification for the customer with the wallet link', async () => {
      const result = await notifyRefundCredited(db, {
        refundRequestId: 'rr_1',
        customerUserId: customerId,
        amountRupees: 1500,
      })

      expect(result.created).toBe(true)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe(customerId)
      expect(rows[0]!.type).toBe('booking_cancelled')
      expect(rows[0]!.link).toBe('/wallet')
    })

    it('is idempotent for the same refund request', async () => {
      const args = {
        refundRequestId: 'rr_dup',
        customerUserId: customerId,
        amountRupees: 1500,
      }
      const first = await notifyRefundCredited(db, args)
      const second = await notifyRefundCredited(db, args)

      expect(first.created).toBe(true)
      expect(second.created).toBe(false)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
    })
  })

  // ── notifyPayoutStateChange (→ vendor) ─────────────────────────────
  describe('notifyPayoutStateChange', () => {
    it('creates a notification for the vendor with the payouts link', async () => {
      const result = await notifyPayoutStateChange(db, {
        bookingId: 'b_payout_1',
        vendorUserId: vendorId,
        state: 'approved',
      })

      expect(result.created).toBe(true)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe(vendorId)
      expect(rows[0]!.type).toBe('payout_processed')
      expect(rows[0]!.link).toBe('/vendor/payouts')
      expect(rows[0]!.title.toLowerCase()).toContain('approved')
    })

    it('uses distinct eventIds per state so transitions do not dedup each other', async () => {
      const held = await notifyPayoutStateChange(db, {
        bookingId: 'b_payout_states',
        vendorUserId: vendorId,
        state: 'held',
      })
      const approved = await notifyPayoutStateChange(db, {
        bookingId: 'b_payout_states',
        vendorUserId: vendorId,
        state: 'approved',
      })

      expect(held.created).toBe(true)
      expect(approved.created).toBe(true)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(2)
    })

    it('is idempotent for the same (booking, state)', async () => {
      const args = {
        bookingId: 'b_payout_dup',
        vendorUserId: vendorId,
        state: 'rejected' as const,
      }
      const first = await notifyPayoutStateChange(db, args)
      const second = await notifyPayoutStateChange(db, args)

      expect(first.created).toBe(true)
      expect(second.created).toBe(false)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
    })

    it("notifies the vendor with a 'payout sent' message for state='paid' (slice 06)", async () => {
      const result = await notifyPayoutStateChange(db, {
        bookingId: 'b_payout_paid',
        vendorUserId: vendorId,
        state: 'paid',
      })

      expect(result.created).toBe(true)

      const rows = await db.select().from(notifications)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.userId).toBe(vendorId)
      expect(rows[0]!.type).toBe('payout_processed')
      expect(rows[0]!.link).toBe('/vendor/payouts')
      expect(rows[0]!.title.toLowerCase()).toContain('sent')
      // Vendor-facing copy uses the domain term "payout" (CONTEXT.md).
      expect(rows[0]!.body.toLowerCase()).toContain('payout')
      // Distinct eventId namespace from approved/held/rejected.
      expect(rows[0]!.eventId).toBe('payout_paid:b_payout_paid')
    })
  })

  // ── preference opt-out is inherited from notify() ──────────────────
  it('skips a disabled channel for a lifecycle helper (preference-aware)', async () => {
    await db.insert(notificationPreferences).values({
      userId: vendorId,
      eventType: 'payout_processed',
      channel: 'email',
      enabled: false,
    })

    await notifyPayoutStateChange(db, {
      bookingId: 'b_payout_prefs',
      vendorUserId: vendorId,
      state: 'approved',
    })

    const outboxRows = await db.select().from(notificationOutbox)
    const byChannel = Object.fromEntries(
      outboxRows.map((r) => [r.channel, r.status]),
    )
    expect(byChannel['in_app']).toBe('pending')
    expect(byChannel['email']).toBe('skipped')
  })
})
