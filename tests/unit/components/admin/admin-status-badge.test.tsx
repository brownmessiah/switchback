import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'

afterEach(() => {
  cleanup()
})

// DESIGN.md §1.3 / §5: status is NEVER conveyed by color alone — every status
// badge pairs a semantic color token WITH a lucide icon. Shared across the
// three money queues so the later admin-table batches reuse one mapping.

describe('AdminStatusBadge (status + icon, never color alone)', () => {
  it('maps an approved/credited state to the success token + an icon', () => {
    render(<AdminStatusBadge status="approved" label="Approved" />)
    const badge = screen.getByText('Approved').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('text-success')
    // paired lucide icon (svg) so the status is not color-only
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a pending state to the warning/info token + an icon', () => {
    render(<AdminStatusBadge status="pending" label="Pending" />)
    const badge = screen.getByText('Pending').closest('[data-slot="badge"]')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a rejected/failed state to the destructive token + an icon', () => {
    render(<AdminStatusBadge status="rejected" label="Rejected" />)
    const badge = screen.getByText('Rejected').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-destructive')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a held state to the warning token + an icon', () => {
    render(<AdminStatusBadge status="held" label="Held" />)
    const badge = screen.getByText('Held').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-warning')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  // Booking lifecycle states (DESIGN.md §4 A3): confirmed → success,
  // disputed / cancelled_* → destructive. Reused by the bookings-list (#89)
  // and dispute-queue (#93) A3 surfaces.
  it('maps confirmed to the success token + an icon', () => {
    render(<AdminStatusBadge status="confirmed" label="Confirmed" />)
    const badge = screen.getByText('Confirmed').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps disputed to the destructive token + an icon', () => {
    render(<AdminStatusBadge status="disputed" label="Disputed" />)
    const badge = screen.getByText('Disputed').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-destructive')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps cancelled booking states to the destructive token + an icon', () => {
    for (const state of [
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
    ]) {
      render(<AdminStatusBadge status={state} label={state} />)
      const badge = screen.getByText(state).closest('[data-slot="badge"]')
      expect(badge!.className, `${state} must be destructive`).toContain('text-destructive')
      expect(badge!.querySelector('svg')).not.toBeNull()
      cleanup()
    }
  })

  // ── Vendor KYC tiers (ADR-0007 / DESIGN.md §2.1) — Identity & Business are
  // "verified Vendor" → success dot; phone is signup-only (cannot publish) →
  // a neutral, un-verified token. Reused by the vendors-list (#87) A3 surface.
  it('maps the identity KYC tier to the success token + an icon', () => {
    render(<AdminStatusBadge status="identity" label="Identity verified" />)
    const badge = screen.getByText('Identity verified').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps the business KYC tier to the success token + an icon', () => {
    render(<AdminStatusBadge status="business" label="Business verified" />)
    const badge = screen.getByText('Business verified').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps the phone KYC tier (signup-only, unverified) to a neutral token + an icon', () => {
    render(<AdminStatusBadge status="phone" label="Phone verified" />)
    const badge = screen.getByText('Phone verified').closest('[data-slot="badge"]')
    // not a success/verified token — phone-tier cannot publish (ADR-0007)
    expect(badge!.className).not.toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  // ── Experience moderation statuses (ADR-0007 / ADR-0013 / DESIGN.md §4 A3) —
  // each status is color + icon, never color alone. Reused by the
  // experience-moderation (#88) A3 surface.
  it('maps a pending_review experience to the warning token + an icon', () => {
    render(<AdminStatusBadge status="pending_review" label="Pending review" />)
    const badge = screen.getByText('Pending review').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-warning')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a published experience to the success token + an icon', () => {
    render(<AdminStatusBadge status="published" label="Published" />)
    const badge = screen.getByText('Published').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a paused experience to the warning token + an icon', () => {
    render(<AdminStatusBadge status="paused" label="Paused" />)
    const badge = screen.getByText('Paused').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-warning')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps an archived experience to the destructive token + an icon', () => {
    render(<AdminStatusBadge status="archived" label="Archived" />)
    const badge = screen.getByText('Archived').closest('[data-slot="badge"]')
    expect(badge!.className).toContain('text-destructive')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })
})
