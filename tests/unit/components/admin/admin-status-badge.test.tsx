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
})
