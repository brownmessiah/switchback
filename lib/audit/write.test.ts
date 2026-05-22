import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { writeAuditLog } from './write'

/**
 * Audit log write helper. Every privileged or money-relevant action
 * routes through writeAuditLog so:
 *   (a) the row write always happens (the helper is the only path),
 *   (b) callers can pass either the top-level db handle or a tx handle
 *       so booking-create / refund-flow can write the audit inside the
 *       same db.transaction() as the business mutation,
 *   (c) the payload type-safety pressure lands at the call site,
 *   (d) future enforcement (e.g. PII redaction, schema validation) has
 *       one chokepoint to mount on.
 */
describe('writeAuditLog', () => {
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
    await db.execute(sql`TRUNCATE TABLE audit_logs`)
  })

  it('writes a row with all fields populated', async () => {
    await writeAuditLog(db, {
      actorUserId: 'user_123',
      action: 'booking.create',
      entityType: 'booking',
      entityId: 'booking_456',
      payload: { commissionRateSnapshot: '20.00', grossRupees: 3000 },
    })
    const rows = await db.select().from(auditLogs)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actorUserId).toBe('user_123')
    expect(rows[0]?.action).toBe('booking.create')
    expect(rows[0]?.entityType).toBe('booking')
    expect(rows[0]?.entityId).toBe('booking_456')
    expect(rows[0]?.payload).toEqual({
      commissionRateSnapshot: '20.00',
      grossRupees: 3000,
    })
  })

  it('accepts a null actorUserId for system-driven actions', async () => {
    await writeAuditLog(db, {
      actorUserId: null,
      action: 'booking.auto_complete',
      entityType: 'booking',
      entityId: 'booking_789',
      payload: { autoCompleted: true, endAtPlus24h: '2026-09-16T13:00:00Z' },
    })
    const [row] = await db.select().from(auditLogs)
    expect(row?.actorUserId).toBeNull()
    expect(row?.action).toBe('booking.auto_complete')
  })

  it('defaults payload to empty object when omitted', async () => {
    await writeAuditLog(db, {
      actorUserId: 'admin_1',
      action: 'vendor.approved',
      entityType: 'vendor',
      entityId: 'u_v',
    })
    const [row] = await db.select().from(auditLogs)
    expect(row?.payload).toEqual({})
  })

  it('writes the row from inside a db.transaction (same tx as caller)', async () => {
    await db.transaction(async (tx) => {
      await writeAuditLog(tx, {
        actorUserId: 'user_tx',
        action: 'wallet.credit',
        entityType: 'wallet_balance',
        entityId: 'user_tx:refund_balance',
        payload: { amountRupees: 1500, source: 'refund' },
      })
    })
    const [row] = await db.select().from(auditLogs)
    expect(row?.actorUserId).toBe('user_tx')
    expect(row?.action).toBe('wallet.credit')
  })

  it('rolls back the audit row when the surrounding transaction aborts', async () => {
    await expect(
      db.transaction(async (tx) => {
        await writeAuditLog(tx, {
          actorUserId: 'user_rollback',
          action: 'booking.create',
          entityType: 'booking',
          entityId: 'booking_rollback',
          payload: { willRollback: true },
        })
        throw new Error('simulated downstream failure')
      }),
    ).rejects.toThrow(/simulated/)
    const rows = await db.select().from(auditLogs)
    expect(rows).toHaveLength(0)
  })

  it('rejects empty action string at the boundary', async () => {
    await expect(
      writeAuditLog(db, {
        actorUserId: 'u',
        action: '',
        entityType: 'booking',
        entityId: 'x',
      }),
    ).rejects.toThrow(/action/i)
  })

  it('rejects empty entityType / entityId', async () => {
    await expect(
      writeAuditLog(db, {
        actorUserId: 'u',
        action: 'x.y',
        entityType: '',
        entityId: 'x',
      }),
    ).rejects.toThrow(/entityType/i)
    await expect(
      writeAuditLog(db, {
        actorUserId: 'u',
        action: 'x.y',
        entityType: 'booking',
        entityId: '',
      }),
    ).rejects.toThrow(/entityId/i)
  })

  it('writes multiple rows preserving createdAt ordering', async () => {
    for (let i = 0; i < 3; i++) {
      await writeAuditLog(db, {
        actorUserId: 'u',
        action: `step.${i}`,
        entityType: 'booking',
        entityId: 'b',
      })
    }
    const rows = await db.select().from(auditLogs).orderBy(auditLogs.createdAt)
    expect(rows.map((r) => r.action)).toEqual(['step.0', 'step.1', 'step.2'])
  })

  it('preserves a deeply nested JSON payload faithfully', async () => {
    const payload = {
      experienceId: 'exp_123',
      pricing: {
        basis: 'experience_bracket:3_5',
        breakdown: [
          { participant: 1, price: '1500.00' },
          { participant: 2, price: '1500.00' },
          { participant: 3, price: '1500.00' },
        ],
      },
      commission: { rate: '20.00', basis: 'vendor_default' },
    }
    await writeAuditLog(db, {
      actorUserId: 'u_c',
      action: 'booking.create',
      entityType: 'booking',
      entityId: 'b_deep',
      payload,
    })
    const [row] = await db.select().from(auditLogs).where(eq(auditLogs.entityId, 'b_deep'))
    expect(row?.payload).toEqual(payload)
  })
})
