import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { users } from '@/db/schema/users'
import { walletBalances } from '@/db/schema/wallet-balances'
import { walletTransactions } from '@/db/schema/wallet-transactions'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import { loadWalletView } from './wallet-view'

/**
 * loadWalletView — the pure read model that backs the dedicated /wallet
 * page. Returns both bucket balances (ADR-0004), a paginated newest-first
 * ledger of wallet_transactions, and the soonest upcoming Switchback-credit
 * expiry. No writes, no audit — read-only.
 */
describe('loadWalletView', () => {
  let db: TestDB
  let teardown: () => Promise<void>

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_wv1', email: 'wv1@example.com' },
      { id: 'u_wv2', email: 'wv2@example.com' },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE wallet_transactions, wallet_balances CASCADE`,
    )
  })

  // ------------------------------------------------------------------------
  // Balances per bucket
  // ------------------------------------------------------------------------

  it('returns both bucket balances as integer rupees', async () => {
    await db.insert(walletBalances).values([
      { userId: 'u_wv1', balanceType: 'refund_balance', amount: '500.00' },
      { userId: 'u_wv1', balanceType: 'switchback_credit', amount: '200.00' },
    ])

    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.balances.refundBalance).toBe(500)
    expect(view.balances.switchbackCredit).toBe(200)
  })

  it('returns zeros for a wallet with no balance rows', async () => {
    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.balances).toEqual({ switchbackCredit: 0, refundBalance: 0 })
    expect(view.transactions).toEqual([])
    expect(view.total).toBe(0)
    expect(view.page).toBe(1)
    expect(view.totalPages).toBe(0)
    expect(view.soonestCreditExpiry).toBeNull()
  })

  it('isolates balances per user', async () => {
    await db.insert(walletBalances).values([
      { userId: 'u_wv1', balanceType: 'refund_balance', amount: '500.00' },
      { userId: 'u_wv2', balanceType: 'refund_balance', amount: '999.00' },
    ])

    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.balances.refundBalance).toBe(500)
  })

  // ------------------------------------------------------------------------
  // Ledger pagination + ordering
  // ------------------------------------------------------------------------

  it('returns the ledger newest-first and preserves signed amounts', async () => {
    await db.insert(walletTransactions).values([
      {
        userId: 'u_wv1',
        balanceType: 'refund_balance',
        amount: '500.00',
        source: 'refund',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: 'u_wv1',
        balanceType: 'switchback_credit',
        amount: '-50.00',
        source: 'checkout_deduction',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      {
        userId: 'u_wv1',
        balanceType: 'switchback_credit',
        amount: '200.00',
        source: 'promo',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ])

    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.total).toBe(3)
    expect(view.transactions).toHaveLength(3)
    // Newest first: 2026-03 (-50), then 2026-02 (200), then 2026-01 (500).
    expect(view.transactions[0]!.amount).toBe(-50)
    expect(view.transactions[0]!.source).toBe('checkout_deduction')
    expect(view.transactions[1]!.amount).toBe(200)
    expect(view.transactions[2]!.amount).toBe(500)
  })

  it('paginates the ledger and reports totalPages', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      userId: 'u_wv1',
      balanceType: 'refund_balance' as const,
      amount: '10.00',
      source: 'admin' as const,
      // Strictly increasing timestamps so newest-first order is deterministic.
      createdAt: new Date(2026, 0, 1, 0, 0, i),
    }))
    await db.insert(walletTransactions).values(rows)

    const page1 = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })
    expect(page1.total).toBe(25)
    expect(page1.totalPages).toBe(3)
    expect(page1.page).toBe(1)
    expect(page1.transactions).toHaveLength(10)

    const page3 = await loadWalletView(db, 'u_wv1', { page: 3, pageSize: 10 })
    expect(page3.page).toBe(3)
    expect(page3.transactions).toHaveLength(5)

    // No overlap between pages — first id of page 1 is not on page 3.
    const page1Ids = new Set(page1.transactions.map((t) => t.id))
    expect(page3.transactions.some((t) => page1Ids.has(t.id))).toBe(false)
  })

  it('clamps an out-of-range page to the last available page worth of data', async () => {
    await db.insert(walletTransactions).values([
      {
        userId: 'u_wv1',
        balanceType: 'refund_balance',
        amount: '10.00',
        source: 'admin',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    // pageSize 10, only 1 row → asking for page 5 yields no rows but a sane shape.
    const view = await loadWalletView(db, 'u_wv1', { page: 5, pageSize: 10 })
    expect(view.total).toBe(1)
    expect(view.totalPages).toBe(1)
    expect(view.transactions).toEqual([])
  })

  // ------------------------------------------------------------------------
  // Soonest credit expiry
  // ------------------------------------------------------------------------

  it('computes the soonest upcoming Switchback-credit expiry', async () => {
    const soon = new Date('2027-01-01T00:00:00.000Z')
    const later = new Date('2027-06-01T00:00:00.000Z')
    await db.insert(walletTransactions).values([
      {
        userId: 'u_wv1',
        balanceType: 'switchback_credit',
        amount: '100.00',
        source: 'promo',
        expiresAt: later,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        userId: 'u_wv1',
        balanceType: 'switchback_credit',
        amount: '100.00',
        source: 'promo',
        expiresAt: soon,
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
      },
      // refund_balance expiry must be ignored — only switchback_credit expires.
      {
        userId: 'u_wv1',
        balanceType: 'refund_balance',
        amount: '50.00',
        source: 'refund',
        expiresAt: new Date('2026-12-01T00:00:00.000Z'),
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
    ])

    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.soonestCreditExpiry).not.toBeNull()
    expect(view.soonestCreditExpiry!.toISOString()).toBe(soon.toISOString())
  })

  it('returns null soonest expiry when no Switchback-credit txn carries an expiry', async () => {
    await db.insert(walletTransactions).values([
      {
        userId: 'u_wv1',
        balanceType: 'switchback_credit',
        amount: '100.00',
        source: 'promo',
        expiresAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ])

    const view = await loadWalletView(db, 'u_wv1', { page: 1, pageSize: 10 })

    expect(view.soonestCreditExpiry).toBeNull()
  })
})
