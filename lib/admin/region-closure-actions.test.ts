import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { regionClosures } from '@/db/schema/region-closures'
import { users } from '@/db/schema/users'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  executeCreateClosure,
  executeDeleteClosure,
  loadRegionClosures,
} from './region-closure-actions'

describe('region closure CRUD', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@outvers.com', name: 'Admin' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE audit_logs, region_closures CASCADE`)
  })

  // ── Create ─────────────────────────────────────────────────────

  it('creates a region closure with valid dates', async () => {
    const result = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'rishikesh',
      startAt: new Date('2026-07-01'),
      endAt: new Date('2026-09-14'),
      reason: 'Monsoon season',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.id).toBeDefined()

    const rows = await loadRegionClosures(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.regionSlug).toBe('rishikesh')
    expect(rows[0]!.reason).toBe('Monsoon season')
    expect(rows[0]!.source).toBe('admin')
  })

  it('rejects when end date is before start date', async () => {
    const result = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'rishikesh',
      startAt: new Date('2026-09-14'),
      endAt: new Date('2026-07-01'),
      reason: 'Bad dates',
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('End date must be after start date')
  })

  it('rejects empty reason', async () => {
    const result = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'rishikesh',
      startAt: new Date('2026-07-01'),
      endAt: new Date('2026-09-14'),
      reason: '',
    })

    expect(result.ok).toBe(false)
  })

  it('rejects empty region slug', async () => {
    const result = await executeCreateClosure(db, 'u_admin', {
      regionSlug: '',
      startAt: new Date('2026-07-01'),
      endAt: new Date('2026-09-14'),
      reason: 'test',
    })

    expect(result.ok).toBe(false)
  })

  it('writes an audit log on create', async () => {
    const result = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'manali',
      startAt: new Date('2026-12-01'),
      endAt: new Date('2027-02-28'),
      reason: 'Winter closure',
    })

    expect(result.ok).toBe(true)

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.region_closure.create'))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.actorUserId).toBe('u_admin')
    expect(logs[0]!.entityType).toBe('region_closure')
  })

  // ── Delete ─────────────────────────────────────────────────────

  it('deletes a region closure', async () => {
    const createResult = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'goa',
      startAt: new Date('2026-06-01'),
      endAt: new Date('2026-09-30'),
      reason: 'Monsoon',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    const deleteResult = await executeDeleteClosure(db, 'u_admin', createResult.id!)
    expect(deleteResult.ok).toBe(true)

    const rows = await loadRegionClosures(db)
    expect(rows).toHaveLength(0)
  })

  it('returns error for non-existent closure', async () => {
    const result = await executeDeleteClosure(
      db,
      'u_admin',
      '00000000-0000-0000-0000-000000000000',
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('not found')
  })

  it('writes an audit log on delete', async () => {
    const createResult = await executeCreateClosure(db, 'u_admin', {
      regionSlug: 'kasol',
      startAt: new Date('2026-06-01'),
      endAt: new Date('2026-09-30'),
      reason: 'Landslides',
    })
    expect(createResult.ok).toBe(true)
    if (!createResult.ok) return

    await executeDeleteClosure(db, 'u_admin', createResult.id!)

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'admin.region_closure.delete'))
    expect(logs).toHaveLength(1)
    expect(logs[0]!.entityId).toBe(createResult.id!)
  })
})
