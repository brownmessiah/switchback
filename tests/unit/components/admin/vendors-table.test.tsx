import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VendorsTable, type VendorsTableRow } from '@/app/admin/vendors/vendors-table'

afterEach(() => {
  cleanup()
})

// #87 vendors LIST redesign to DESIGN.md §4 A3:
//  - KYC tier as a distinct-per-tier ramp via `kycTierBadge` (Business →
//    success, Identity → info, Phone → warning) so the strongest tier is
//    visually distinct instead of all-green — status color + icon, never color
//    alone (DESIGN.md §1.3 / §5; ADR-0007 distinct labels)
//  - numeric columns (commission %, SLA %) right-aligned + `.tabular-nums`
//    (DESIGN.md §1.3 / §2.2)
//  - each row links to its `/admin/vendors/[id]` detail (B6 master → detail;
//    the E2E navigates list → detail via `a[href*="/admin/vendors/"]`)
//  - no moderation actions on the LIST (the KYC approve/reject/suspend live on
//    the [id] detail, #101)
//
// ADR-0018 reversal note: the table is now a `<ResponsiveTable>`, so jsdom
// (which doesn't evaluate media queries) renders BOTH the `≥ md` `Table` and
// the `< md` stacked-Card list. The assertions scope to the `≥ md` `Table`
// (`[data-slot='table']`) so they query exactly one rendering.

const ROWS: VendorsTableRow[] = [
  {
    userId: 'vendor_business',
    businessName: 'River Adventures',
    slug: 'river-adventures',
    kycTier: 'business',
    commissionRate: '15.00',
    responseTimeSlaScore: '92.5',
    suspended: false,
    createdAt: new Date('2026-01-10T00:00:00Z'),
    userName: 'Riya Owner',
    userEmail: 'riya@river.test',
  },
  {
    userId: 'vendor_identity',
    businessName: 'Sky High Paragliding',
    slug: 'sky-high',
    kycTier: 'identity',
    commissionRate: '18.00',
    responseTimeSlaScore: '80.0',
    suspended: false,
    createdAt: new Date('2026-02-15T00:00:00Z'),
    userName: 'Sam Pilot',
    userEmail: 'sam@sky.test',
  },
  {
    userId: 'vendor_phone',
    businessName: 'New Signup Co',
    slug: 'new-signup',
    kycTier: 'phone',
    commissionRate: '20.00',
    responseTimeSlaScore: '0',
    suspended: true,
    createdAt: new Date('2026-03-20T00:00:00Z'),
    userName: 'Pat New',
    userEmail: 'pat@new.test',
  },
]

/**
 * The `≥ md` `Table` rendering. Both renderings are in the jsdom DOM at once
 * (the reversal is a CSS `hidden md:block` / `md:hidden` swap), so every
 * row/value query is scoped here to target exactly one rendering.
 */
function table(container: HTMLElement): HTMLElement {
  const t = container.querySelector("[data-slot='table']")
  expect(t).not.toBeNull()
  return t as HTMLElement
}

describe('VendorsTable (A3)', () => {
  it('links each row to its /admin/vendors/[id] detail', () => {
    render(<VendorsTable rows={ROWS} />)
    const link = document.querySelector('a[href="/admin/vendors/vendor_business"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('River Adventures')
  })

  it('renders the Identity-tier KYC on the INFO rung of the ramp (distinct from Business) with its ADR-0007 label', () => {
    const { container } = render(<VendorsTable rows={ROWS} />)
    const row = within(table(container))
      .getByText('Sky High Paragliding')
      .closest('tr') as HTMLElement
    const badge = within(row).getByText('Identity verified').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('text-info')
    expect(badge!.className).not.toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders the Business-tier KYC on the strongest (success) rung with its ADR-0007 label', () => {
    const { container } = render(<VendorsTable rows={ROWS} />)
    const row = within(table(container))
      .getByText('River Adventures')
      .closest('tr') as HTMLElement
    const badge = within(row).getByText('Business verified').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders the phone-tier KYC on the WARNING rung (signup-only, distinct from success)', () => {
    const { container } = render(<VendorsTable rows={ROWS} />)
    const row = within(table(container))
      .getByText('New Signup Co')
      .closest('tr') as HTMLElement
    const badge = within(row).getByText('Phone verified').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-warning')
    expect(badge!.className).not.toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('gives the three tiers three distinct badge colours (tier ramp, not all-green)', () => {
    const { container } = render(<VendorsTable rows={ROWS} />)
    const grid = within(table(container))
    const kycBadge = (label: string) =>
      grid.getByText(label).closest('[data-slot="badge"]')!
    const business = kycBadge('Business verified')
    const identity = kycBadge('Identity verified')
    const phone = kycBadge('Phone verified')
    const ink = (el: Element) =>
      (el.className.match(/text-(success|info|warning|foreground)/) ?? [''])[0]
    expect(new Set([ink(business), ink(identity), ink(phone)]).size).toBe(3)
  })

  it('renders numeric commission / SLA columns in tabular-nums', () => {
    const { container } = render(<VendorsTable rows={ROWS} />)
    const row = within(table(container))
      .getByText('River Adventures')
      .closest('tr') as HTMLElement
    const commission = within(row).getByText('15%')
    expect(commission.className).toContain('tabular-nums')
  })

  it('renders an in-table empty state when there are no vendors', () => {
    render(<VendorsTable rows={[]} />)
    expect(screen.getAllByText(/No vendors/i).length).toBeGreaterThan(0)
  })

  // The admin's accept/reject decision is the thing they came to this screen
  // to act on, so it belongs in the list — otherwise finding who is waiting
  // means opening every Vendor in turn.
  describe('application decision column', () => {
    it('shows which vendors are awaiting a decision', () => {
      const { container } = render(<VendorsTable rows={ROWS} />)
      const row = within(table(container))
        .getByText('River Adventures')
        .closest('tr') as HTMLElement
      expect(within(row).getByText(/Awaiting decision/i)).toBeInTheDocument()
    })

    it('distinguishes approved from rejected', () => {
      const rows: VendorsTableRow[] = [
        { ...ROWS[0]!, userId: 'v_ok', businessName: 'Approved Co', applicationStatus: 'approved' },
        { ...ROWS[0]!, userId: 'v_no', businessName: 'Rejected Co', applicationStatus: 'rejected' },
      ]
      const { container } = render(<VendorsTable rows={rows} />)
      const grid = within(table(container))
      const approvedRow = grid.getByText('Approved Co').closest('tr') as HTMLElement
      const rejectedRow = grid.getByText('Rejected Co').closest('tr') as HTMLElement

      expect(within(approvedRow).getByText(/^Approved$/i)).toBeInTheDocument()
      expect(within(rejectedRow).getByText(/^Rejected$/i)).toBeInTheDocument()
    })
  })
})
