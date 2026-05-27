import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { notificationOutbox } from '@/db/schema/notification-outbox'
import { notificationPreferences } from '@/db/schema/notification-preferences'
import { notifications } from '@/db/schema/notifications'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { notify } from './notify'

describe('notify() engine', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  const testUserId = 'user_notify_test'

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    // Seed a user for FK references
    await db.insert(users).values({
      id: testUserId,
      email: 'notify@test.com',
      emailVerified: false,
      phoneNumberVerified: false,
    })
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE notification_outbox CASCADE`)
    await db.execute(sql`TRUNCATE TABLE notifications CASCADE`)
    await db.execute(sql`TRUNCATE TABLE notification_preferences CASCADE`)
  })

  // ─── TDD Test 1: creates notification row + outbox rows ─────────
  it('creates a notification row and one outbox row per channel', async () => {
    const result = await notify(db, {
      userId: testUserId,
      type: 'booking_created',
      title: 'Booking confirmed',
      body: 'Your rafting trip is confirmed.',
      link: '/bookings/123',
      eventId: 'evt_booking_created_123',
    })

    expect(result.created).toBe(true)
    expect(result.notificationId).toBeTruthy()
    expect(result.outboxRows).toBe(4) // in_app, email, whatsapp, sms

    // Verify notification row
    const notifRows = await db.select().from(notifications)
    expect(notifRows).toHaveLength(1)
    expect(notifRows[0]!.userId).toBe(testUserId)
    expect(notifRows[0]!.type).toBe('booking_created')
    expect(notifRows[0]!.title).toBe('Booking confirmed')
    expect(notifRows[0]!.body).toBe('Your rafting trip is confirmed.')
    expect(notifRows[0]!.link).toBe('/bookings/123')
    expect(notifRows[0]!.eventId).toBe('evt_booking_created_123')
    expect(notifRows[0]!.readAt).toBeNull()

    // Verify outbox rows
    const outboxRows = await db.select().from(notificationOutbox)
    expect(outboxRows).toHaveLength(4)
    const channels = outboxRows.map((r) => r.channel).sort()
    expect(channels).toEqual(['email', 'in_app', 'sms', 'whatsapp'])

    // All should be pending (no preferences set = all enabled by default)
    for (const row of outboxRows) {
      expect(row.status).toBe('pending')
      expect(row.notificationId).toBe(result.notificationId)
    }
  })

  // ─── TDD Test 2: idempotency — duplicate eventId skips ──────────
  it('skips creating duplicate notification for same eventId', async () => {
    const eventId = 'evt_idempotent_test'

    const first = await notify(db, {
      userId: testUserId,
      type: 'booking_cancelled',
      title: 'Booking cancelled',
      body: 'Your booking was cancelled.',
      eventId,
    })
    expect(first.created).toBe(true)

    const second = await notify(db, {
      userId: testUserId,
      type: 'booking_cancelled',
      title: 'Booking cancelled (retry)',
      body: 'Your booking was cancelled (retry).',
      eventId,
    })
    expect(second.created).toBe(false)
    expect(second.notificationId).toBe(first.notificationId)
    expect(second.outboxRows).toBe(0)

    // Only one notification row
    const notifRows = await db.select().from(notifications)
    expect(notifRows).toHaveLength(1)
    expect(notifRows[0]!.title).toBe('Booking cancelled') // original title preserved
  })

  // ─── TDD Test 3: respects user preferences ──────────────────────
  it('marks disabled channels as skipped in outbox', async () => {
    // Disable email and whatsapp for booking_completed
    await db.insert(notificationPreferences).values([
      {
        userId: testUserId,
        eventType: 'booking_completed',
        channel: 'email',
        enabled: false,
      },
      {
        userId: testUserId,
        eventType: 'booking_completed',
        channel: 'whatsapp',
        enabled: false,
      },
    ])

    const result = await notify(db, {
      userId: testUserId,
      type: 'booking_completed',
      title: 'Trip completed!',
      body: 'Your rafting trip is done.',
      eventId: 'evt_completed_prefs',
    })

    expect(result.created).toBe(true)
    expect(result.outboxRows).toBe(4)

    const outboxRows = await db.select().from(notificationOutbox)
    const byChannel = Object.fromEntries(
      outboxRows.map((r) => [r.channel, r.status]),
    )

    expect(byChannel['in_app']).toBe('pending')
    expect(byChannel['email']).toBe('skipped')
    expect(byChannel['whatsapp']).toBe('skipped')
    expect(byChannel['sms']).toBe('pending')
  })

  // ─── Without eventId, always creates ────────────────────────────
  it('creates notification even without eventId', async () => {
    const result = await notify(db, {
      userId: testUserId,
      type: 'review_posted',
      title: 'New review',
      body: 'Someone reviewed your experience.',
    })

    expect(result.created).toBe(true)
    expect(result.notificationId).toBeTruthy()

    const notifRows = await db.select().from(notifications)
    expect(notifRows).toHaveLength(1)
    expect(notifRows[0]!.eventId).toBeNull()
  })

  // ─── Preferences only affect the matching event type ────────────
  it('does not cross-pollinate preferences across event types', async () => {
    // Disable email for booking_created
    await db.insert(notificationPreferences).values({
      userId: testUserId,
      eventType: 'booking_created',
      channel: 'email',
      enabled: false,
    })

    // Send a review_posted notification — email should still be pending
    await notify(db, {
      userId: testUserId,
      type: 'review_posted',
      title: 'New review',
      body: 'Someone reviewed your experience.',
      eventId: 'evt_review_cross',
    })

    const outboxRows = await db.select().from(notificationOutbox)
    const emailRow = outboxRows.find((r) => r.channel === 'email')
    expect(emailRow!.status).toBe('pending')
  })
})
