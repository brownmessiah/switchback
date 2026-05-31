import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { users } from '@/db/schema/users'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { computeGrantExpiry, executeGrantCredit } from './grant-logic'

// ── Tests ───────────────────────────────────────────────────────────
//
// adminGrantCredit (via the testable executeGrantCredit core) grants credit
// to a Customer's wallet. Per ADR-0004 the Outvers credit bucket is closed-
// loop promotional balance that EXPIRES 12–18 months from issue, while the
// Refund balance is a real, cashable liability that never expires. These
// tests pin the bucket + expiry behaviour the admin loyalty grant must honour.

describe('admin loyalty grant (executeGrantCredit)', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  const ADMIN_ID = 'u_admin_loyalty'
  const CUSTOMER_ID = 'u_customer_loyalty'

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
      sql`TRUNCATE TABLE audit_logs, wallet_transactions, wallet_balances, users CASCADE`,
    )
    await db.insert(users).values([
      { id: ADMIN_ID, email: 'admin-loyalty@test.com' },
      { id: CUSTOMER_ID, email: 'customer-loyalty@test.com' },
    ])
  })

  // ── computeGrantExpiry (ADR-0004) ─────────────────────────────────

  describe('computeGrantExpiry', () => {
    it('returns a +12-month expiry for outvers_credit (ADR-0004)', () => {
      const issuedAt = new Date('2026-05-30T00:00:00.000Z')
      const expiry = computeGrantExpiry('outvers_credit', issuedAt)
      expect(expiry).toBeInstanceOf(Date)
      expect(expiry!.toISOString()).toBe('2027-05-30T00:00:00.000Z')
    })

    it('places the expiry inside the ADR-0004 12–18 month window', () => {
      const issuedAt = new Date('2026-05-30T00:00:00.000Z')
      const expiry = computeGrantExpiry('outvers_credit', issuedAt)!
      const monthsOut =
        (expiry.getTime() - issuedAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
      expect(monthsOut).toBeGreaterThanOrEqual(11.5)
      expect(monthsOut).toBeLessThanOrEqual(18.5)
    })

    it('returns undefined (no expiry) for refund_balance — a cashable liability', () => {
      const expiry = computeGrantExpiry('refund_balance', new Date())
      expect(expiry).toBeUndefined()
    })
  })

  // ── Outvers-credit grant ──────────────────────────────────────────

  describe('executeGrantCredit → outvers_credit', () => {
    it('credits the Outvers-credit bucket WITH an expiry + audit row', async () => {
      const result = await executeGrantCredit(db, ADMIN_ID, {
        userId: CUSTOMER_ID,
        amountRupees: 500,
        balanceType: 'outvers_credit',
        reason: 'Goodwill gesture for delay',
      })

      expect(result.ok).toBe(true)

      // The ledger row lands in the outvers_credit bucket WITH an expiry.
      const txns = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, CUSTOMER_ID))
      expect(txns).toHaveLength(1)
      expect(txns[0]!.balanceType).toBe('outvers_credit')
      expect(Math.floor(Number(txns[0]!.amount))).toBe(500)
      expect(txns[0]!.source).toBe('admin')
      // ── The defect this test guards: Outvers credit MUST expire (ADR-0004).
      expect(txns[0]!.expiresAt, 'Outvers credit must carry an expiry').not.toBeNull()
      const expiry = txns[0]!.expiresAt!
      const created = txns[0]!.createdAt
      const monthsOut =
        (expiry.getTime() - created.getTime()) / (1000 * 60 * 60 * 24 * 30)
      expect(monthsOut).toBeGreaterThanOrEqual(11.5)
      expect(monthsOut).toBeLessThanOrEqual(18.5)

      // The aggregate balance lands in the SAME (outvers_credit) bucket.
      const [balance] = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.userId, CUSTOMER_ID))
      expect(balance!.balanceType).toBe('outvers_credit')
      expect(Math.floor(Number(balance!.amount))).toBe(500)

      // wallet.grant_credit audit row with the admin as actor.
      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.grant_credit'))
      expect(logs).toHaveLength(1)
      expect(logs[0]!.actorUserId).toBe(ADMIN_ID)
      expect(logs[0]!.payload).toMatchObject({
        userId: CUSTOMER_ID,
        amountRupees: 500,
        balanceType: 'outvers_credit',
        source: 'admin',
      })
      expect((logs[0]!.payload as Record<string, unknown>).expiresAt).not.toBeNull()
    })

    it('does NOT credit the Refund balance bucket', async () => {
      await executeGrantCredit(db, ADMIN_ID, {
        userId: CUSTOMER_ID,
        amountRupees: 300,
        balanceType: 'outvers_credit',
        reason: 'loyalty reward',
      })

      const refundRows = await db
        .select()
        .from(walletBalances)
        .where(eq(walletBalances.balanceType, 'refund_balance'))
      expect(refundRows).toHaveLength(0)
    })
  })

  // ── Refund-balance grant (no expiry) ──────────────────────────────

  describe('executeGrantCredit → refund_balance', () => {
    it('credits the Refund balance bucket with NO expiry (cashable liability)', async () => {
      const result = await executeGrantCredit(db, ADMIN_ID, {
        userId: CUSTOMER_ID,
        amountRupees: 700,
        balanceType: 'refund_balance',
        reason: 'manual refund adjustment',
      })

      expect(result.ok).toBe(true)

      const [txn] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.userId, CUSTOMER_ID))
      expect(txn!.balanceType).toBe('refund_balance')
      expect(txn!.expiresAt).toBeNull()
    })
  })

  // ── Validation ────────────────────────────────────────────────────

  describe('validation', () => {
    it('rejects a non-positive amount', async () => {
      const result = await executeGrantCredit(db, ADMIN_ID, {
        userId: CUSTOMER_ID,
        amountRupees: 0,
        balanceType: 'outvers_credit',
        reason: 'invalid',
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a missing reason', async () => {
      const result = await executeGrantCredit(db, ADMIN_ID, {
        userId: CUSTOMER_ID,
        amountRupees: 100,
        balanceType: 'outvers_credit',
        reason: '',
      })
      expect(result.ok).toBe(false)
    })
  })
})
