import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { commissionTiers } from '@/db/schema/commission-tiers'
import { pricingTiers } from '@/db/schema/pricing-tiers'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Structural safety net for the append-only invariant on audit_logs +
 * slug-safe CHECK constraints on commission_tiers.name and
 * pricing_tiers.name (migration 0005). The lib/audit/write helper is
 * the only intended write path; the trigger is the DB-level floor for
 * the same property.
 */
describe('audit_logs append-only + tier name slug constraint', () => {
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
    await db.execute(sql`TRUNCATE TABLE audit_logs, commission_tiers, pricing_tiers`)
  })

  describe('audit_logs immutability', () => {
    it('allows INSERTs (append-only does not block writes)', async () => {
      await db.insert(auditLogs).values({
        actorUserId: 'u_admin',
        action: 'booking.create',
        entityType: 'booking',
        entityId: 'b_1',
        payload: { gross: 3000 },
      })
      const rows = await db.select().from(auditLogs)
      expect(rows).toHaveLength(1)
    })

    it('rejects UPDATEs to any column', async () => {
      const [row] = await db
        .insert(auditLogs)
        .values({
          actorUserId: 'u_admin',
          action: 'booking.create',
          entityType: 'booking',
          entityId: 'b_2',
          payload: {},
        })
        .returning({ id: auditLogs.id })
      await expect(
        db.update(auditLogs).set({ action: 'tampered' }).where(eq(auditLogs.id, row!.id)),
      ).rejects.toThrow()
      await expect(
        db
          .update(auditLogs)
          .set({ payload: { tampered: true } })
          .where(eq(auditLogs.id, row!.id)),
      ).rejects.toThrow()
    })

    it('rejects DELETEs', async () => {
      const [row] = await db
        .insert(auditLogs)
        .values({
          actorUserId: 'u_admin',
          action: 'vendor.approved',
          entityType: 'vendor',
          entityId: 'u_v',
          payload: {},
        })
        .returning({ id: auditLogs.id })
      await expect(
        db.execute(sql`DELETE FROM audit_logs WHERE id = ${row!.id}`),
      ).rejects.toThrow()
      const rows = await db.select().from(auditLogs)
      expect(rows).toHaveLength(1)
    })

    it('TRUNCATE still works (admin destructive reset path, by design)', async () => {
      await db.insert(auditLogs).values({
        actorUserId: 'u_admin',
        action: 'x',
        entityType: 'y',
        entityId: 'z',
        payload: {},
      })
      await db.execute(sql`TRUNCATE TABLE audit_logs`)
      const rows = await db.select().from(auditLogs)
      expect(rows).toHaveLength(0)
    })
  })

  describe('commission_tiers.name slug constraint', () => {
    const baseValues = {
      startAt: new Date('2026-09-01T00:00:00Z'),
      endAt: new Date('2026-09-30T23:59:59Z'),
      rateOverride: '15.00',
      reason: 'test',
      createdByAdminUserId: 'u_admin',
    }

    it('accepts slug-safe names (lowercase / digits / hyphen / underscore)', async () => {
      for (const name of ['diwali_2026', 'monsoon-2026', 'combo-default', 'a1', 'x']) {
        await db.insert(commissionTiers).values({ name, ...baseValues })
        await db.execute(sql`TRUNCATE TABLE commission_tiers`)
      }
    })

    it('rejects names with uppercase letters', async () => {
      await expect(
        db.insert(commissionTiers).values({ name: 'Diwali2026', ...baseValues }),
      ).rejects.toThrow()
    })

    it('rejects names containing HTML / script characters (stored-XSS guard)', async () => {
      await expect(
        db
          .insert(commissionTiers)
          .values({ name: '<script>alert(1)</script>', ...baseValues }),
      ).rejects.toThrow()
    })

    it('rejects names with spaces', async () => {
      await expect(
        db.insert(commissionTiers).values({ name: 'diwali 2026', ...baseValues }),
      ).rejects.toThrow()
    })

    it('rejects empty names', async () => {
      await expect(
        db.insert(commissionTiers).values({ name: '', ...baseValues }),
      ).rejects.toThrow()
    })
  })

  describe('pricing_tiers.name slug constraint', () => {
    const baseValues = {
      startAt: new Date('2026-09-01T00:00:00Z'),
      endAt: new Date('2026-09-30T23:59:59Z'),
      pricePerPersonOverride: '999.00',
      reason: 'test',
      createdByAdminUserId: 'u_admin',
    }

    it('accepts slug-safe names', async () => {
      await db.insert(pricingTiers).values({ name: 'monsoon_2026', ...baseValues })
    })

    it('rejects names with HTML', async () => {
      await expect(
        db
          .insert(pricingTiers)
          .values({ name: '<img src=x onerror=alert(1)>', ...baseValues }),
      ).rejects.toThrow()
    })
  })
})
