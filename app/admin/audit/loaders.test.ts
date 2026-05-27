import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { queryAuditLogs, getDistinctEntityTypes, getDistinctActions } from './loaders'

// ── Test helpers ────────────────────────────────────────────────────

async function seedAuditLogs(db: TestDB): Promise<void> {
  // Seed users
  await db.insert(users).values([
    { id: 'u_admin1', email: 'admin1@test.com', name: 'Admin One' },
    { id: 'u_admin2', email: 'admin2@test.com', name: 'Admin Two' },
  ])

  // Seed diverse audit logs
  await db.insert(auditLogs).values([
    {
      actorUserId: 'u_admin1',
      action: 'admin.vendor.approve',
      entityType: 'vendor_profile',
      entityId: 'v_1',
      payload: { tier: 'basic' },
    },
    {
      actorUserId: 'u_admin1',
      action: 'admin.refund.approve',
      entityType: 'refund_request',
      entityId: 'r_1',
      payload: { amountRupees: 1500 },
    },
    {
      actorUserId: 'u_admin2',
      action: 'admin.payout.approve',
      entityType: 'payout',
      entityId: 'p_1',
      payload: { amountRupees: 5000 },
    },
    {
      actorUserId: null,
      action: 'booking.auto_complete',
      entityType: 'booking',
      entityId: 'b_1',
      payload: { autoCompleted: true },
    },
    {
      actorUserId: 'u_admin1',
      action: 'admin.sub_admin.create',
      entityType: 'admin_profile',
      entityId: 'u_sub1',
      payload: { email: 'sub@test.com' },
    },
  ])
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Audit log loaders', () => {
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
    await db.execute(sql`TRUNCATE TABLE audit_logs, users CASCADE`)
  })

  // ── queryAuditLogs ────────────────────────────────────────────────

  describe('queryAuditLogs', () => {
    it('returns all logs when no filters applied', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db)

      expect(result.total).toBe(5)
      expect(result.rows).toHaveLength(5)
    })

    it('filters by entityType', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, { entityType: 'booking' })

      expect(result.total).toBe(1)
      expect(result.rows[0]!.entityType).toBe('booking')
      expect(result.rows[0]!.action).toBe('booking.auto_complete')
    })

    it('filters by action (partial match)', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, { action: 'approve' })

      expect(result.total).toBe(3) // vendor.approve, refund.approve, payout.approve
      expect(result.rows.every((r) => r.action.includes('approve'))).toBe(true)
    })

    it('filters by actorUserId', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, { actorUserId: 'u_admin2' })

      expect(result.total).toBe(1)
      expect(result.rows[0]!.actorUserId).toBe('u_admin2')
    })

    it('filters by date range', async () => {
      await seedAuditLogs(db)

      // All logs were just created, so dateFrom = 1 minute ago should match all
      const dateFrom = new Date(Date.now() - 60_000)
      const dateTo = new Date(Date.now() + 60_000)

      const result = await queryAuditLogs(db, { dateFrom, dateTo })
      expect(result.total).toBe(5)

      // Future dates should match none
      const futureFrom = new Date(Date.now() + 86400_000)
      const futureTo = new Date(Date.now() + 172800_000)
      const futureResult = await queryAuditLogs(db, { dateFrom: futureFrom, dateTo: futureTo })
      expect(futureResult.total).toBe(0)
    })

    it('combines multiple filters', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, {
        entityType: 'vendor_profile',
        actorUserId: 'u_admin1',
      })

      expect(result.total).toBe(1)
      expect(result.rows[0]!.action).toBe('admin.vendor.approve')
    })

    it('respects limit and offset for pagination', async () => {
      await seedAuditLogs(db)

      const page1 = await queryAuditLogs(db, { limit: 2, offset: 0 })
      expect(page1.rows).toHaveLength(2)
      expect(page1.total).toBe(5)

      const page2 = await queryAuditLogs(db, { limit: 2, offset: 2 })
      expect(page2.rows).toHaveLength(2)

      const page3 = await queryAuditLogs(db, { limit: 2, offset: 4 })
      expect(page3.rows).toHaveLength(1)
    })

    it('includes actor email and name in results', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, { actorUserId: 'u_admin1' })

      expect(result.rows[0]!.actorEmail).toBe('admin1@test.com')
      expect(result.rows[0]!.actorName).toBe('Admin One')
    })

    it('returns null actor info for system actions', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db, { entityType: 'booking' })

      expect(result.rows[0]!.actorUserId).toBeNull()
      expect(result.rows[0]!.actorEmail).toBeNull()
    })

    it('returns empty results when no logs match', async () => {
      const result = await queryAuditLogs(db, { entityType: 'nonexistent' })

      expect(result.total).toBe(0)
      expect(result.rows).toHaveLength(0)
    })

    it('orders by createdAt descending (newest first)', async () => {
      await seedAuditLogs(db)

      const result = await queryAuditLogs(db)

      // All logs created in sequence, so last inserted should be first
      for (let i = 0; i < result.rows.length - 1; i++) {
        expect(
          result.rows[i]!.createdAt.getTime(),
        ).toBeGreaterThanOrEqual(
          result.rows[i + 1]!.createdAt.getTime(),
        )
      }
    })
  })

  // ── getDistinctEntityTypes ────────────────────────────────────────

  describe('getDistinctEntityTypes', () => {
    it('returns distinct entity types sorted alphabetically', async () => {
      await seedAuditLogs(db)

      const types = await getDistinctEntityTypes(db)

      expect(types).toEqual([
        'admin_profile',
        'booking',
        'payout',
        'refund_request',
        'vendor_profile',
      ])
    })

    it('returns empty array when no logs exist', async () => {
      const types = await getDistinctEntityTypes(db)
      expect(types).toEqual([])
    })
  })

  // ── getDistinctActions ────────────────────────────────────────────

  describe('getDistinctActions', () => {
    it('returns distinct actions sorted alphabetically', async () => {
      await seedAuditLogs(db)

      const actions = await getDistinctActions(db)

      expect(actions).toEqual([
        'admin.payout.approve',
        'admin.refund.approve',
        'admin.sub_admin.create',
        'admin.vendor.approve',
        'booking.auto_complete',
      ])
    })
  })
})
