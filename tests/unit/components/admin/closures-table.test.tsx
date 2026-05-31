import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ClosuresTable, type ClosureTableRow } from '@/app/admin/region-closures/closures-table'

afterEach(() => {
  cleanup()
})

// #94 region-closures redesign to DESIGN.md §4 A3:
//  - semantic AdminStatusBadge for closure status (active → success/warning,
//    upcoming → info, past → neutral), status color + icon, never color alone.
//  - the REASON text stays in the row DOM (E2E #25 matches the row by reason).
//  - the per-row delete control is preserved.

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
    regionSlug: 'manali',
    startAt: new Date(NOW + DAY),
    endAt: new Date(NOW + 2 * DAY),
    reason: 'Planned road closure',
    source: 'admin',
  },
]

describe('ClosuresTable (A3)', () => {
  it('renders the closure reason text in the row (E2E row-by-reason match)', () => {
    render(<ClosuresTable rows={ROWS} />)
    expect(screen.getByText('Monsoon — rafting unsafe')).toBeInTheDocument()
  })

  it('maps an active closure to a semantic AdminStatusBadge (color + icon)', () => {
    render(<ClosuresTable rows={ROWS} />)
    const activeRow = screen.getByText('Monsoon — rafting unsafe').closest('tr') as HTMLElement
    const badge = within(activeRow).getByText('Active').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps an upcoming closure to the info token + an icon', () => {
    render(<ClosuresTable rows={ROWS} />)
    const upcomingRow = screen.getByText('Planned road closure').closest('tr') as HTMLElement
    const badge = within(upcomingRow).getByText('Upcoming').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-info')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders a delete control per row', () => {
    render(<ClosuresTable rows={ROWS} />)
    const activeRow = screen.getByText('Monsoon — rafting unsafe').closest('tr') as HTMLElement
    expect(within(activeRow).getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('renders an in-table empty state when there are no closures', () => {
    render(<ClosuresTable rows={[]} />)
    expect(screen.getByText(/No region closures/i)).toBeInTheDocument()
  })
})
