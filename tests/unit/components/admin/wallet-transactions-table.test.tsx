import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  WalletTransactionsTable,
  type WalletTransactionRow,
} from '@/app/admin/loyalty/wallet-transactions-table'

afterEach(() => {
  cleanup()
})

// A1/polish: opaque UUID references render as a short human ref (OV-…) with the
// full id behind a title; human-readable references render verbatim.
//
// NOTE: ResponsiveTable renders BOTH the `≥ md` Table and the `< md` Card stack
// at once (a CSS swap, not conditional mounting), so jsdom sees both. Assertions
// that need a single match scope to the `≥ md` Table via `screen.getByRole`.

const BASE: Omit<WalletTransactionRow, 'id' | 'referenceId'> = {
  userId: 'u_1',
  balanceType: 'refund_balance',
  amount: 500,
  source: 'cancellation',
  createdAt: new Date('2026-06-01T10:00:00Z'),
  userName: 'Aanya',
  userEmail: 'aanya@test',
}

/** The `≥ md` Table rendering. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

describe('WalletTransactionsTable references (ResponsiveTable)', () => {
  it('renders an opaque UUID reference as a short OV- human ref with the full id in title', () => {
    const rows: WalletTransactionRow[] = [
      { ...BASE, id: 'tx_uuid', referenceId: '96b0bbfb-6087-4d3e-8a1f-0011223344ff' },
    ]
    render(<WalletTransactionsTable rows={rows} />)
    const ref = within(table()).getByText('OV-44FF')
    expect(ref).toBeInTheDocument()
    expect(ref.getAttribute('title')).toBe('96b0bbfb-6087-4d3e-8a1f-0011223344ff')
    // The raw UUID must NOT be the visible label.
    expect(within(table()).queryByText('96b0bbfb-6087-4d3e-8a1f-0011223344ff')).toBeNull()
  })

  it('renders a human-readable reference verbatim (not shortened)', () => {
    const rows: WalletTransactionRow[] = [
      { ...BASE, id: 'tx_human', referenceId: 'catalog-refund-credit' },
    ]
    render(<WalletTransactionsTable rows={rows} />)
    expect(within(table()).getByText('catalog-refund-credit')).toBeInTheDocument()
  })

  it('renders an em-dash for a missing reference', () => {
    const rows: WalletTransactionRow[] = [{ ...BASE, id: 'tx_null', referenceId: null }]
    render(<WalletTransactionsTable rows={rows} />)
    expect(within(table()).getByText('—')).toBeInTheDocument()
  })
})
