import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { writeWhatsAppSendIntent } from './whatsapp-send-intent'

describe('WhatsApp send intent (Task 21)', () => {
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
    await db.execute(sql`TRUNCATE TABLE audit_logs CASCADE`)
  })

  it('writes an audit_logs row with action notification.whatsapp.intent', async () => {
    await writeWhatsAppSendIntent(db, {
      bookingId: 'booking_123',
      recipientPhone: '+919876543210',
      templateName: 'booking_confirmation',
      templateBody: 'Your booking for Grand Rafting Trip is confirmed!',
    })

    const rows = await db.select().from(auditLogs)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.action).toBe('notification.whatsapp.intent')
    expect(rows[0]!.entityType).toBe('booking')
    expect(rows[0]!.entityId).toBe('booking_123')
    expect(rows[0]!.payload).toMatchObject({
      recipientPhone: '+919876543210',
      templateName: 'booking_confirmation',
      templateBody: 'Your booking for Grand Rafting Trip is confirmed!',
    })
  })

  it('records a null actorUserId (system-initiated notification)', async () => {
    await writeWhatsAppSendIntent(db, {
      bookingId: 'booking_456',
      recipientPhone: '+919876543210',
      templateName: 'booking_confirmation',
      templateBody: 'Confirmed!',
    })

    const [row] = await db.select().from(auditLogs)
    expect(row!.actorUserId).toBeNull()
  })
})
