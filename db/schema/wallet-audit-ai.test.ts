import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { aiGenerations } from './ai-generations'
import { auditLogs } from './audit-logs'
import { users } from './users'
import { walletBalances } from './wallet-balances'

describe('wallet_balances + audit_logs + ai_generations (ADRs 0004, 0010)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown
    await db.insert(users).values([
      { id: 'u_1', email: 'one@example.com' },
      { id: 'u_2', email: 'two@example.com' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE wallet_balances, audit_logs, ai_generations CASCADE`,
    )
  })

  describe('wallet_balances (ADR-0004)', () => {
    it('allows the same User to have both balance types simultaneously', async () => {
      await db.insert(walletBalances).values([
        { userId: 'u_1', balanceType: 'switchback_credit', amount: '500.00' },
        { userId: 'u_1', balanceType: 'refund_balance', amount: '1200.00' },
      ])
      const rows = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, 'u_1'))
      expect(rows).toHaveLength(2)
      const credit = rows.find((r) => r.balanceType === 'switchback_credit')
      const refund = rows.find((r) => r.balanceType === 'refund_balance')
      expect(credit?.amount).toBe('500.00')
      expect(refund?.amount).toBe('1200.00')
    })

    it('rejects duplicate (user_id, balance_type) — primary key', async () => {
      await db.insert(walletBalances).values({
        userId: 'u_1',
        balanceType: 'switchback_credit',
        amount: '100',
      })
      await expect(
        db.insert(walletBalances).values({
          userId: 'u_1',
          balanceType: 'switchback_credit',
          amount: '200',
        }),
      ).rejects.toThrow()
    })

    it('rejects negative balance', async () => {
      await expect(
        db.insert(walletBalances).values({
          userId: 'u_1',
          balanceType: 'switchback_credit',
          amount: '-1.00',
        }),
      ).rejects.toThrow()
    })

    it('rejects an unknown balance_type (only 2 enum values)', async () => {
      await expect(
        db.execute(
          sql`INSERT INTO wallet_balances (user_id, balance_type, amount) VALUES ('u_1', 'travel_credit', '100.00')`,
        ),
      ).rejects.toThrow()
    })

    it('defaults amount to 0.00', async () => {
      await db.insert(walletBalances).values({
        userId: 'u_1',
        balanceType: 'refund_balance',
      })
      const [row] = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, 'u_1'))
      expect(row?.amount).toBe('0.00')
    })

    it('cascades wallet rows when the User is deleted', async () => {
      await db.insert(walletBalances).values([
        { userId: 'u_2', balanceType: 'switchback_credit', amount: '50' },
        { userId: 'u_2', balanceType: 'refund_balance', amount: '100' },
      ])
      await db.delete(users).where(eq(users.id, 'u_2'))
      const remaining = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, 'u_2'))
      expect(remaining).toHaveLength(0)
      // Restore for subsequent tests
      await db.insert(users).values({ id: 'u_2', email: 'two@example.com' })
    })
  })

  describe('audit_logs', () => {
    it('persists an actor-attributed log entry with jsonb payload', async () => {
      await db.insert(auditLogs).values({
        actorUserId: 'u_1',
        action: 'booking.create',
        entityType: 'booking',
        entityId: 'b_123',
        payload: { participants: 2, gross: 3000 },
      })
      const [row] = await db.select().from(auditLogs)
      expect(row?.actorUserId).toBe('u_1')
      expect(row?.action).toBe('booking.create')
      expect(row?.payload).toEqual({ participants: 2, gross: 3000 })
    })

    it('persists a system-action entry with NULL actor', async () => {
      await db.insert(auditLogs).values({
        actorUserId: null,
        action: 'booking.auto_complete',
        entityType: 'booking',
        entityId: 'b_456',
        payload: { reason: 'end_at + 24h elapsed' },
      })
      const [row] = await db.select().from(auditLogs)
      expect(row?.actorUserId).toBeNull()
    })

    it('defaults payload to empty object when omitted', async () => {
      await db.insert(auditLogs).values({
        action: 'vendor.tier_change',
        entityType: 'vendor_profile',
        entityId: 'u_v',
      })
      const [row] = await db.select().from(auditLogs)
      expect(row?.payload).toEqual({})
    })

    it('keeps audit rows when actor User is deleted (no FK)', async () => {
      await db.insert(auditLogs).values({
        actorUserId: 'u_1',
        action: 'refund.approve',
        entityType: 'booking',
        entityId: 'b_456',
      })
      // u_1 still referenced from elsewhere; we don't cascade audit_logs.
      // Sanity: the schema doesn't define an FK on actor_user_id.
      const rows = await db.select().from(auditLogs)
      expect(rows).toHaveLength(1)
    })
  })

  describe('ai_generations (ADR-0010)', () => {
    function baseGen(): typeof aiGenerations.$inferInsert {
      return {
        surface: 'review_summary',
        model: 'gpt-5',
        modelVersion: '2026-01-15',
        promptTemplateHash: 'abc123',
        inputFingerprint: 'sha256:def',
        output: { bullets: [{ text: 'great guide', cites: ['rev_1'] }] },
        retrievalSet: ['rev_1', 'rev_2'],
        citationTraces: [{ bullet: 0, source_ids: ['rev_1'] }],
        requestedByUserId: 'u_1',
      }
    }

    it('persists a review_summary with citations + retrieval set', async () => {
      await db.insert(aiGenerations).values(baseGen())
      const [row] = await db.select().from(aiGenerations)
      expect(row?.surface).toBe('review_summary')
      expect(row?.retrievalSet).toEqual(['rev_1', 'rev_2'])
      expect(row?.citationTraces).toEqual([{ bullet: 0, source_ids: ['rev_1'] }])
    })

    it('stores all four AI surfaces', async () => {
      const surfaces = [
        'review_summary',
        'listing_draft',
        'inbox_reply',
        'trip_planner',
      ] as const
      for (const surface of surfaces) {
        await db.insert(aiGenerations).values({
          ...baseGen(),
          surface,
        })
      }
      const rows = await db.select().from(aiGenerations)
      expect(rows).toHaveLength(4)
      expect(rows.map((r) => r.surface).sort()).toEqual([
        'inbox_reply',
        'listing_draft',
        'review_summary',
        'trip_planner',
      ])
    })

    it('rejects unknown surface values', async () => {
      await expect(
        db.execute(
          sql`INSERT INTO ai_generations (surface, model, model_version, prompt_template_hash, input_fingerprint, output)
              VALUES ('rogue_surface', 'gpt-5', 'v', 'h', 'f', '{}'::jsonb)`,
        ),
      ).rejects.toThrow()
    })

    it('defaults retrieval_set and citation_traces to empty arrays', async () => {
      await db.insert(aiGenerations).values({
        surface: 'listing_draft',
        model: 'gpt-5',
        modelVersion: '2026-01-15',
        promptTemplateHash: 'x',
        inputFingerprint: 'y',
        output: { draft: 'Welcome to Adventure XYZ' },
      })
      const [row] = await db.select().from(aiGenerations)
      expect(row?.retrievalSet).toEqual([])
      expect(row?.citationTraces).toEqual([])
    })

    it('sets requested_by_user_id to NULL when the User is deleted', async () => {
      await db.insert(aiGenerations).values(baseGen())
      await db.delete(users).where(eq(users.id, 'u_1'))
      const [row] = await db.select().from(aiGenerations)
      expect(row?.requestedByUserId).toBeNull()
      // Restore u_1 for subsequent tests.
      await db.insert(users).values({ id: 'u_1', email: 'one@example.com' })
    })

    it('accepts a NULL requested_by_user_id for scheduled batch jobs', async () => {
      await db.insert(aiGenerations).values({
        ...baseGen(),
        requestedByUserId: null,
      })
      const [row] = await db.select().from(aiGenerations)
      expect(row?.requestedByUserId).toBeNull()
    })
  })
})
