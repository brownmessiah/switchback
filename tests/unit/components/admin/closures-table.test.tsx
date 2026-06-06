import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ClosuresTable, type ClosureTableRow } from '@/app/admin/region-closures/closures-table'

afterEach(() => {
  cleanup()
})

// #94 region-closures redesign to DESIGN.md §4 A3, migrated to the shared
// ResponsiveTable (ADR-0018 / DESIGN.md §8.5):
//  - semantic AdminStatusBadge for closure status (active → success/warning,
//    upcoming → info, past → neutral), status color + icon, never color alone.
//  - the REASON text stays in the row DOM (E2E #25 matches the row by reason).
//  - the per-row delete control is preserved.
//  - the Region column renders the ADR-0013 display name, not the raw slug; the
//    slug stays available via the cell title (A1/polish: no raw slugs in the UI).
//
// NOTE: ResponsiveTable renders BOTH the `≥ md` Table and the `< md` Card stack
// at once (a CSS swap, not conditional mounting), so jsdom sees both. Assertions
// that need a single match scope to the `≥ md` Table via `screen.getByRole`.

const NOW = Date.now()
const DAY = 24 * 60 * 60 * 1000

const ROWS: ClosureTableRow[] = [
  {
    id: 'closure-active',
    regionSlug: 'rishikesh',
    startAt: new Date(NOW - DAY),
    endAt: new Date(NOW + DAY),
    reason: 'Monsoon — rafting unsafe',
    source: 'admin',
  },
  {
    id: 'closure-upcoming',
    regionSlug: 'leh-ladakh',
    startAt: new Date(NOW + DAY),
    endAt: new Date(NOW + 2 * DAY),
    reason: 'Planned road closure',
    source: 'admin',
  },
]

/** The `≥ md` Table rendering — where the E2E `tr` selectors resolve. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

describe('ClosuresTable (A3, ResponsiveTable)', () => {
  it('renders the closure reason text in the row (E2E row-by-reason match)', () => {
    render(<ClosuresTable rows={ROWS} />)
    expect(within(table()).getByText('Monsoon — rafting unsafe')).toBeInTheDocument()
  })

  it('renders the region DISPLAY NAME, not the raw slug, with the slug behind a title', () => {
    render(<ClosuresTable rows={ROWS} />)
    // leh-ladakh → "Leh-Ladakh" per the ADR-0013 registry.
    const cell = within(table()).getByText('Leh-Ladakh')
    expect(cell).toBeInTheDocument()
    expect(cell.getAttribute('title')).toBe('leh-ladakh')
    // The raw slug must NOT be the visible label.
    expect(within(table()).queryByText('leh-ladakh')).toBeNull()
  })

  it('maps an active closure to a semantic AdminStatusBadge (color + icon)', () => {
    render(<ClosuresTable rows={ROWS} />)
    const activeRow = within(table())
      .getByText('Monsoon — rafting unsafe')
      .closest('tr') as HTMLElement
    const badge = within(activeRow).getByText('Active').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps an upcoming closure to the info token + an icon', () => {
    render(<ClosuresTable rows={ROWS} />)
    const upcomingRow = within(table())
      .getByText('Planned road closure')
      .closest('tr') as HTMLElement
    const badge = within(upcomingRow).getByText('Upcoming').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-info')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders a delete control per row', () => {
    render(<ClosuresTable rows={ROWS} />)
    const activeRow = within(table())
      .getByText('Monsoon — rafting unsafe')
      .closest('tr') as HTMLElement
    expect(within(activeRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('renders an empty state when there are no closures', () => {
    render(<ClosuresTable rows={[]} />)
    expect(screen.getAllByText(/No region closures/i).length).toBeGreaterThan(0)
  })
})
