import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { PromoTable, type PromoTableRow } from '@/app/admin/promo/promo-table'

afterEach(() => {
  cleanup()
})

// #95 promo-codes redesign to DESIGN.md §4 A3 (admin-table, direction B),
// migrated to the shared ResponsiveTable (ADR-0018 / DESIGN.md §8.5):
//  - status (active / inactive / scheduled / expired) as a semantic
//    AdminStatusBadge — status color + paired icon, never color alone
//    (DESIGN.md §1.3 / §5)
//  - the credit amount is money → right-aligned + `.tabular-nums` with the ₹
//    glyph (DESIGN.md §1.3 / §2.2)
//  - the promo CODE text stays in the row DOM (E2E #26 matches the row by code)
//  - per-row actions are preserved (PromoActionsCell)
//
// NOTE: ResponsiveTable renders BOTH the `≥ md` Table and the `< md` Card stack
// at once (a CSS hidden/md:hidden swap, not conditional mounting), so jsdom —
// which doesn't evaluate media queries — sees both. Assertions that need a
// single match scope to the `≥ md` Table via `screen.getByRole('table')`.

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

const ROWS: PromoTableRow[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    code: 'WELCOME500',
    creditAmount: '500.00',
    maxTotalUses: 100,
    currentUses: 0,
    perUserLimit: 1,
    active: true,
    startsAt: null,
    expiresAt: null,
    adminName: 'Admin',
    adminEmail: 'admin@seed.test',
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    code: 'STALE100',
    creditAmount: '100.00',
    maxTotalUses: null,
    currentUses: 3,
    perUserLimit: 1,
    active: false,
    startsAt: null,
    expiresAt: null,
    adminName: 'Admin',
    adminEmail: 'admin@seed.test',
  },
  {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    code: 'EXPIRED50',
    creditAmount: '50.00',
    maxTotalUses: null,
    currentUses: 0,
    perUserLimit: 1,
    active: true,
    startsAt: null,
    expiresAt: new Date(NOW - DAY),
    adminName: 'Admin',
    adminEmail: 'admin@seed.test',
  },
]

/** The `≥ md` Table rendering — where the E2E `tr` selectors resolve. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

describe('PromoTable (A3, ResponsiveTable)', () => {
  it('renders the promo code text in the row (E2E row-by-code match)', () => {
    render(<PromoTable rows={ROWS} />)
    expect(within(table()).getByText('WELCOME500')).toBeInTheDocument()
  })

  it('preserves a per-row data-promo-id hook on the table row', () => {
    render(<PromoTable rows={ROWS} />)
    expect(
      table().querySelector(
        'tr[data-promo-id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]',
      ),
    ).not.toBeNull()
  })

  it('maps an active promo to a semantic AdminStatusBadge (success color + icon)', () => {
    render(<PromoTable rows={ROWS} />)
    const row = within(table()).getByText('WELCOME500').closest('tr') as HTMLElement
    const badge = within(row).getByText('Active').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps an inactive promo to a neutral AdminStatusBadge with an icon', () => {
    render(<PromoTable rows={ROWS} />)
    const row = within(table()).getByText('STALE100').closest('tr') as HTMLElement
    const badge = within(row).getByText('Inactive').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps an expired (but active) promo to the destructive AdminStatusBadge + icon', () => {
    render(<PromoTable rows={ROWS} />)
    const row = within(table()).getByText('EXPIRED50').closest('tr') as HTMLElement
    const badge = within(row).getByText('Expired').closest('[data-slot="badge"]')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders the credit amount as ₹ money in a tabular-nums cell', () => {
    render(<PromoTable rows={ROWS} />)
    const row = within(table()).getByText('WELCOME500').closest('tr') as HTMLElement
    const cell = within(row).getByText('₹500').closest('td') as HTMLElement
    expect(cell.className).toContain('tabular-nums')
  })

  it('renders an empty state when there are no promos', () => {
    render(<PromoTable rows={[]} />)
    expect(screen.getAllByText(/No promo codes/i).length).toBeGreaterThan(0)
  })
})
