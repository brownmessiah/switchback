import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { auditLogs } from '@/db/schema/audit-logs'
import { promoCodes } from '@/db/schema/promo-codes'
import { promoRedemptions } from '@/db/schema/promo-redemptions'
import { users } from '@/db/schema/users'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { balanceFromLedger, grantCredit, redeemPromo } from './wallet-ledger'

/**
 * Wallet ledger operations — immutable transaction log, promo redemption,
 * and balance-from-ledger reconciliation. Per ADR-0004.
 */
describe('wallet ledger operations', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_admin', email: 'admin@example.com' },
      { id: 'u_c1', email: 'c1@example.com' },
      { id: 'u_c2', email: 'c2@example.com' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE audit_logs, promo_redemptions, promo_codes, wallet_transactions, wallet_balances CASCADE`,
    )
  })

  // ========================================================================
  // grantCredit
  // ========================================================================

  describe('grantCredit', () => {
    it('creates a wallet_transactions row with correct source and amount', async () => {
      const result = await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 500,
        source: 'admin',
        balanceType: 'switchback_credit',
      })

      expect(result.walletTransactionId).toMatch(/^[0-9a-f-]{36}$/)

      const [txn] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, result.walletTransactionId))

      expect(txn).toBeDefined()
      expect(txn!.userId).toBe('u_c1')
      expect(txn!.balanceType).toBe('switchback_credit')
      expect(txn!.amount).toBe('500.00')
      expect(txn!.source).toBe('admin')
      expect(txn!.referenceId).toBeNull()
      expect(txn!.expiresAt).toBeNull()
    })

    it('upserts the aggregate wallet_balances row', async () => {
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 300,
        source: 'referral',
        balanceType: 'switchback_credit',
      })

      const [bal] = await db
        .select()
        .from(walletBalances)
        .where(
          and(
            eq(walletBalances.userId, 'u_c1'),
            eq(walletBalances.balanceType, 'switchback_credit'),
          ),
        )

      expect(bal).toBeDefined()
      expect(Number(bal!.amount)).toBe(300)

      // Second grant should add to existing
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 200,
        source: 'admin',
        balanceType: 'switchback_credit',
      })

      const [bal2] = await db
        .select()
        .from(walletBalances)
        .where(
          and(
            eq(walletBalances.userId, 'u_c1'),
            eq(walletBalances.balanceType, 'switchback_credit'),
          ),
        )

      expect(Number(bal2!.amount)).toBe(500)
    })

    it('sets expires_at on the transaction when provided', async () => {
      const expiry = new Date('2027-06-01T00:00:00Z')
      const result = await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 100,
        source: 'promo',
        balanceType: 'switchback_credit',
        expiresAt: expiry,
      })

      const [txn] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, result.walletTransactionId))

      expect(txn!.expiresAt).toBeDefined()
      expect(txn!.expiresAt!.toISOString()).toBe(expiry.toISOString())
    })

    it('writes an audit row with source and reference', async () => {
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 750,
        source: 'admin',
        balanceType: 'refund_balance',
        referenceId: 'manual-adj-001',
        actorUserId: 'u_admin',
      })

      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.grant_credit'))

      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.amountRupees).toBe(750)
      expect(payload.balanceType).toBe('refund_balance')
      expect(payload.source).toBe('admin')
      expect(payload.referenceId).toBe('manual-adj-001')
    })

    it('rejects non-positive amount', async () => {
      await expect(
        grantCredit(db, {
          userId: 'u_c1',
          amountRupees: 0,
          source: 'admin',
          balanceType: 'switchback_credit',
        }),
      ).rejects.toThrow(/positive/i)
    })

    it('rejects non-integer amount', async () => {
      await expect(
        grantCredit(db, {
          userId: 'u_c1',
          amountRupees: 99.5,
          source: 'admin',
          balanceType: 'switchback_credit',
        }),
      ).rejects.toThrow(/integer/i)
    })
  })

  // ========================================================================
  // redeemPromo
  // ========================================================================

  describe('redeemPromo', () => {
    async function seedPromo(overrides: Partial<typeof promoCodes.$inferInsert> = {}) {
      const [row] = await db
        .insert(promoCodes)
        .values({
          code: overrides.code ?? 'WELCOME500',
          creditAmount: overrides.creditAmount ?? '500.00',
          maxTotalUses: overrides.maxTotalUses ?? 100,
          perUserLimit: overrides.perUserLimit ?? 1,
          active: overrides.active ?? true,
          startsAt: overrides.startsAt ?? null,
          expiresAt: overrides.expiresAt ?? null,
          createdByAdminId: overrides.createdByAdminId ?? 'u_admin',
        })
        .returning()

      return row!
    }

    it('valid code → credit granted, current_uses incremented atomically', async () => {
      const promo = await seedPromo()

      const result = await redeemPromo(db, { userId: 'u_c1', code: 'WELCOME500' })

      expect(result.walletTransactionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.creditedAmount).toBe(500)

      // wallet_transactions row created
      const [txn] = await db
        .select()
        .from(walletTransactions)
        .where(eq(walletTransactions.id, result.walletTransactionId))
      expect(txn).toBeDefined()
      expect(txn!.source).toBe('promo')
      expect(txn!.amount).toBe('500.00')
      expect(txn!.balanceType).toBe('switchback_credit')

      // current_uses incremented
      const [updated] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, promo.id))
      expect(updated!.currentUses).toBe(1)

      // promo_redemptions row created
      const [redemption] = await db
        .select()
        .from(promoRedemptions)
        .where(eq(promoRedemptions.promoCodeId, promo.id))
      expect(redemption).toBeDefined()
      expect(redemption!.customerUserId).toBe('u_c1')
      expect(redemption!.walletTransactionId).toBe(result.walletTransactionId)

      // aggregate balance updated
      const [bal] = await db
        .select()
        .from(walletBalances)
        .where(
          and(
            eq(walletBalances.userId, 'u_c1'),
            eq(walletBalances.balanceType, 'switchback_credit'),
          ),
        )
      expect(Number(bal!.amount)).toBe(500)
    })

    it('atomic counter prevents exceeding max_total_uses', async () => {
      await seedPromo({ code: 'LIMITED2', maxTotalUses: 2 })

      // First two succeed
      await redeemPromo(db, { userId: 'u_c1', code: 'LIMITED2' })
      await redeemPromo(db, { userId: 'u_c2', code: 'LIMITED2' })

      // Third should fail — create a third user for this test
      await db
        .insert(users)
        .values({ id: 'u_c3', email: 'c3@example.com' })
        .onConflictDoNothing()

      await expect(
        redeemPromo(db, { userId: 'u_c3', code: 'LIMITED2' }),
      ).rejects.toThrow(/maximum usage limit/i)

      // Verify counter stayed at 2
      const [promo] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.code, 'LIMITED2'))
      expect(promo!.currentUses).toBe(2)
    })

    it('per-user limit enforcement (unique constraint rejects second redemption)', async () => {
      await seedPromo({ code: 'ONCE_ONLY', perUserLimit: 1 })

      await redeemPromo(db, { userId: 'u_c1', code: 'ONCE_ONLY' })

      await expect(
        redeemPromo(db, { userId: 'u_c1', code: 'ONCE_ONLY' }),
      ).rejects.toThrow(/already redeemed/i)
    })

    it('expired code rejected', async () => {
      await seedPromo({
        code: 'EXPIRED',
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      })

      await expect(
        redeemPromo(db, { userId: 'u_c1', code: 'EXPIRED' }),
      ).rejects.toThrow(/expired/i)
    })

    it('inactive code rejected', async () => {
      await seedPromo({ code: 'INACTIVE', active: false })

      await expect(
        redeemPromo(db, { userId: 'u_c1', code: 'INACTIVE' }),
      ).rejects.toThrow(/inactive/i)
    })

    it('code that has not started yet is rejected', async () => {
      await seedPromo({
        code: 'FUTURE',
        startsAt: new Date('2099-01-01T00:00:00Z'),
      })

      await expect(
        redeemPromo(db, { userId: 'u_c1', code: 'FUTURE' }),
      ).rejects.toThrow(/not started/i)
    })

    it('nonexistent code throws', async () => {
      await expect(
        redeemPromo(db, { userId: 'u_c1', code: 'DOES_NOT_EXIST' }),
      ).rejects.toThrow(/not found/i)
    })

    it('writes wallet.redeem_promo audit row', async () => {
      await seedPromo({ code: 'AUDIT_TEST' })

      await redeemPromo(db, { userId: 'u_c1', code: 'AUDIT_TEST' })

      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'wallet.redeem_promo'))

      expect(rows).toHaveLength(1)
      const payload = rows[0]?.payload as Record<string, unknown>
      expect(payload.code).toBe('AUDIT_TEST')
      expect(payload.creditAmount).toBe(500)
      expect(payload.userId).toBe('u_c1')
    })

    it('promo with no max_total_uses allows unlimited redemptions', async () => {
      await seedPromo({ code: 'UNLIMITED', maxTotalUses: null, perUserLimit: 1 })

      await redeemPromo(db, { userId: 'u_c1', code: 'UNLIMITED' })
      await redeemPromo(db, { userId: 'u_c2', code: 'UNLIMITED' })

      const [promo] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.code, 'UNLIMITED'))
      expect(promo!.currentUses).toBe(2)
    })
  })

  // ========================================================================
  // balanceFromLedger
  // ========================================================================

  describe('balanceFromLedger', () => {
    it('computes sum of credits grouped by balance_type', async () => {
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 500,
        source: 'promo',
        balanceType: 'switchback_credit',
      })
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 300,
        source: 'admin',
        balanceType: 'switchback_credit',
      })
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 1000,
        source: 'refund',
        balanceType: 'refund_balance',
      })

      const balance = await balanceFromLedger(db, 'u_c1')
      expect(balance.switchbackCredit).toBe(800)
      expect(balance.refundBalance).toBe(1000)
    })

    it('returns zeros for a user with no transactions', async () => {
      const balance = await balanceFromLedger(db, 'u_c1')
      expect(balance.switchbackCredit).toBe(0)
      expect(balance.refundBalance).toBe(0)
    })

    it('handles only switchback_credit transactions', async () => {
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 250,
        source: 'referral',
        balanceType: 'switchback_credit',
      })

      const balance = await balanceFromLedger(db, 'u_c1')
      expect(balance.switchbackCredit).toBe(250)
      expect(balance.refundBalance).toBe(0)
    })

    it('does not mix balances across users', async () => {
      await grantCredit(db, {
        userId: 'u_c1',
        amountRupees: 100,
        source: 'admin',
        balanceType: 'switchback_credit',
      })
      await grantCredit(db, {
        userId: 'u_c2',
        amountRupees: 999,
        source: 'admin',
        balanceType: 'switchback_credit',
      })

      const balance1 = await balanceFromLedger(db, 'u_c1')
      const balance2 = await balanceFromLedger(db, 'u_c2')

      expect(balance1.switchbackCredit).toBe(100)
      expect(balance2.switchbackCredit).toBe(999)
    })
  })

  // ========================================================================
  // End-to-end: create promo → redeem → verify ledger balance
  // ========================================================================

  describe('end-to-end promo flow', () => {
    it('create → redeem → checkout deduction → ledger matches', async () => {
      // 1. Admin creates promo
      const [promo] = await db
        .insert(promoCodes)
        .values({
          code: 'E2E_TEST',
          creditAmount: '500.00',
          maxTotalUses: 10,
          perUserLimit: 1,
          active: true,
          createdByAdminId: 'u_admin',
        })
        .returning()

      // 2. Customer redeems
      const result = await redeemPromo(db, { userId: 'u_c1', code: 'E2E_TEST' })
      expect(result.creditedAmount).toBe(500)

      // 3. Simulate checkout deduction by inserting a negative ledger entry
      await db.insert(walletTransactions).values({
        userId: 'u_c1',
        balanceType: 'switchback_credit',
        amount: '-200.00',
        source: 'checkout_deduction',
        referenceId: 'booking-xyz',
      })

      // 4. Verify ledger balance
      const balance = await balanceFromLedger(db, 'u_c1')
      expect(balance.switchbackCredit).toBe(300) // 500 - 200

      // 5. Verify promo usage
      const [updatedPromo] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.id, promo!.id))
      expect(updatedPromo!.currentUses).toBe(1)

      // 6. Verify redemption record
      const redemptions = await db
        .select()
        .from(promoRedemptions)
        .where(
          and(
            eq(promoRedemptions.promoCodeId, promo!.id),
            eq(promoRedemptions.customerUserId, 'u_c1'),
          ),
        )
      expect(redemptions).toHaveLength(1)
    })
  })
})
