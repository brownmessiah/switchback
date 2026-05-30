import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { BookingsTable, type BookingsTableRow } from '@/app/admin/bookings/bookings-table'

afterEach(() => {
  cleanup()
})

// #89 bookings list redesign to DESIGN.md §4 A3:
//  - semantic AdminStatusBadge per Booking state (status color + icon, never
//    color alone — DESIGN.md §1.3 / §5)
//  - money right-aligned in `.tabular-nums` (DESIGN.md §1.3 / §2.2)
//  - per-row link to `/admin/bookings/[id]` (B6 master → detail)
//  - preserved E2E hooks: data-booking-id + data-booking-state

const ROWS: BookingsTableRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    state: 'confirmed',
    participantCount: 2,
    grossTotalSnapshot: '5000.00',
    paymentMode: 'full_upfront',
    confirmedAt: new Date('2026-05-01T00:00:00Z'),
    customerName: 'Alice Customer',
    customerEmail: 'alice@test.com',
    experienceTitle: 'White Water Rafting',
    vendorBusinessName: 'River Adventures',
    vendorUserId: 'vendor_1',
    slotStart: new Date('2026-06-15T09:00:00Z'),
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    state: 'disputed',
    participantCount: 4,
    grossTotalSnapshot: '9000.00',
    paymentMode: 'partial_pay',
    confirmedAt: new Date('2026-05-02T00:00:00Z'),
    customerName: 'Bob Customer',
    customerEmail: 'bob@test.com',
    experienceTitle: 'Paragliding',
    vendorBusinessName: 'Sky High',
    vendorUserId: 'vendor_2',
    slotStart: null,
  },
]

describe('BookingsTable (A3)', () => {
  it('renders one row per booking carrying data-booking-id + data-booking-state', () => {
    render(<BookingsTable rows={ROWS} />)
    const confirmedRow = document.querySelector(
      'tr[data-booking-id="11111111-1111-1111-1111-111111111111"]',
    )
    expect(confirmedRow).not.toBeNull()
    expect(confirmedRow!.getAttribute('data-booking-state')).toBe('confirmed')

    const disputedRow = document.querySelector(
      'tr[data-booking-id="22222222-2222-2222-2222-222222222222"]',
    )
    expect(disputedRow!.getAttribute('data-booking-state')).toBe('disputed')
  })

  it('maps each Booking state to a semantic AdminStatusBadge (color + icon)', () => {
    render(<BookingsTable rows={ROWS} />)
    const confirmedRow = document.querySelector(
      'tr[data-booking-id="11111111-1111-1111-1111-111111111111"]',
    ) as HTMLElement
    const confirmedBadge = within(confirmedRow)
      .getByText('Confirmed')
      .closest('[data-slot="badge"]')
    expect(confirmedBadge!.className).toContain('text-success')
    expect(confirmedBadge!.querySelector('svg')).not.toBeNull()

    const disputedRow = document.querySelector(
      'tr[data-booking-id="22222222-2222-2222-2222-222222222222"]',
    ) as HTMLElement
    const disputedBadge = within(disputedRow)
      .getByText('Disputed')
      .closest('[data-slot="badge"]')
    expect(disputedBadge!.className).toContain('text-destructive')
    expect(disputedBadge!.querySelector('svg')).not.toBeNull()
  })

  it('renders money right-aligned in tabular-nums', () => {
    render(<BookingsTable rows={ROWS} />)
    const amount = screen.getByText('₹5,000')
    expect(amount.className).toContain('tabular-nums')
    expect(amount.className).toContain('text-right')
  })

  it('links each row to its /admin/bookings/[id] detail', () => {
    render(<BookingsTable rows={ROWS} />)
    const link = document.querySelector(
      'a[href="/admin/bookings/11111111-1111-1111-1111-111111111111"]',
    )
    expect(link).not.toBeNull()
  })

  it('renders an in-table empty state when there are no bookings', () => {
    render(<BookingsTable rows={[]} />)
    expect(screen.getByText(/No bookings/i)).toBeInTheDocument()
  })
})
