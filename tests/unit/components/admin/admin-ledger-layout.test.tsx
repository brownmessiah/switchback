import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AdminLedgerLayout,
  LedgerDetailEmpty,
} from '@/app/admin/_components/admin-ledger-layout'

/**
 * Responsive contract for the admin ledger detail pane (DESIGN.md §8.4 / §8.5
 * item 6, ADR-0018). The `24rem` detail column is an `lg`-only exception:
 *   - `lg` (≥ 1024px): side-by-side grid, detail in a sticky column.
 *   - `< lg`: detail surfaced as a bottom Sheet over the full-width list.
 *
 * The strict invariant the E2E suite leans on: exactly ONE
 * `data-testid="ledger-detail-pane"` landmark is mounted at any width (the
 * column OR the Sheet, never both), so the single-match `getByTestId` always
 * resolves.
 */

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * Force `useIsDesktop` down one branch by stubbing `matchMedia`. When omitted,
 * jsdom has no `matchMedia`, so the hook keeps its `true` (desktop) default —
 * exactly the path the pre-existing ledger tests exercise.
 */
function stubViewport(isDesktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

const LIST = <div data-testid="list-pane">Queue list</div>
const REAL_DETAIL = <div data-testid="detail-body">Selected record breakdown</div>
const EMPTY_DETAIL = <LedgerDetailEmpty message="Select a record." />

describe('AdminLedgerLayout — responsive detail pane', () => {
  it('renders the side-by-side column at desktop (default jsdom viewport)', () => {
    render(<AdminLedgerLayout list={LIST} detail={REAL_DETAIL} />)

    const panes = screen.getAllByTestId('ledger-detail-pane')
    expect(panes).toHaveLength(1)
    // Inline detail body is present in the column (no portal at desktop).
    expect(screen.getByTestId('detail-body')).toBeInTheDocument()
    // It is the <aside> column, not a Sheet overlay.
    expect(panes[0].tagName).toBe('ASIDE')
  })

  it('keeps exactly one detail-pane landmark at desktop even when empty', () => {
    stubViewport(true)
    render(<AdminLedgerLayout list={LIST} detail={EMPTY_DETAIL} />)

    expect(screen.getAllByTestId('ledger-detail-pane')).toHaveLength(1)
    expect(screen.getByText('Select a record.')).toBeInTheDocument()
  })

  it('below lg: no side column is mounted and a selected detail opens the Sheet', () => {
    stubViewport(false)
    render(<AdminLedgerLayout list={LIST} detail={REAL_DETAIL} />)

    // The list always renders.
    expect(screen.getByTestId('list-pane')).toBeInTheDocument()
    // Exactly one detail-pane landmark — now the Sheet's, in a portal.
    const panes = screen.getAllByTestId('ledger-detail-pane')
    expect(panes).toHaveLength(1)
    // It is NOT the desktop <aside> column.
    expect(panes[0].tagName).not.toBe('ASIDE')
    // The selected detail body is visible inside the open Sheet.
    expect(screen.getByTestId('detail-body')).toBeInTheDocument()
  })

  it('below lg: an empty (unselected) detail keeps the Sheet closed', () => {
    stubViewport(false)
    render(<AdminLedgerLayout list={LIST} detail={EMPTY_DETAIL} />)

    // The list still renders full-width...
    expect(screen.getByTestId('list-pane')).toBeInTheDocument()
    // ...but the closed Sheet mounts no detail-pane landmark and no body.
    expect(screen.queryByTestId('ledger-detail-pane')).not.toBeInTheDocument()
    expect(screen.queryByText('Select a record.')).not.toBeInTheDocument()
  })
})
