import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VendorsTable, type VendorsTableRow } from '@/app/admin/vendors/vendors-table'

afterEach(() => {
  cleanup()
})

// #87 vendors LIST redesign to DESIGN.md §4 A3:
//  - KYC tier as a semantic AdminStatusBadge (Identity/Business → success
//    "verified Vendor" dot, phone → neutral signup-only) with ADR-0007 distinct
//    labels — status color + icon, never color alone (DESIGN.md §1.3 / §5)
//  - numeric columns (commission %, SLA %) right-aligned + `.tabular-nums`
//    (DESIGN.md §1.3 / §2.2)
//  - each row links to its `/admin/vendors/[id]` detail (B6 master → detail;
//    the E2E navigates list → detail via `a[href*="/admin/vendors/"]`)
//  - no moderation actions on the LIST (the KYC approve/reject/suspend live on
//    the [id] detail, #101)

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

describe('VendorsTable (A3)', () => {
  it('links each row to its /admin/vendors/[id] detail', () => {
    render(<VendorsTable rows={ROWS} />)
    const link = document.querySelector('a[href="/admin/vendors/vendor_business"]')
    expect(link).not.toBeNull()
    expect(link!.textContent).toContain('River Adventures')
  })

  it('renders the Identity-tier KYC as a verified (success) AdminStatusBadge with its ADR-0007 label', () => {
    render(<VendorsTable rows={ROWS} />)
    const row = screen.getByText('Sky High Paragliding').closest('tr') as HTMLElement
    const badge = within(row).getByText('Identity verified').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders the Business-tier KYC as a verified (success) AdminStatusBadge with its ADR-0007 label', () => {
    render(<VendorsTable rows={ROWS} />)
    const row = screen.getByText('River Adventures').closest('tr') as HTMLElement
    const badge = within(row).getByText('Business verified').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders the phone-tier KYC as a neutral (non-verified) AdminStatusBadge', () => {
    render(<VendorsTable rows={ROWS} />)
    const row = screen.getByText('New Signup Co').closest('tr') as HTMLElement
    const badge = within(row).getByText('Phone verified').closest('[data-slot="badge"]')
    expect(badge!.className).not.toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('renders numeric commission / SLA columns in tabular-nums', () => {
    render(<VendorsTable rows={ROWS} />)
    const row = screen.getByText('River Adventures').closest('tr') as HTMLElement
    const commission = within(row).getByText('15%')
    expect(commission.className).toContain('tabular-nums')
  })

  it('renders an in-table empty state when there are no vendors', () => {
    render(<VendorsTable rows={[]} />)
    expect(screen.getByText(/No vendors/i)).toBeInTheDocument()
  })
})
