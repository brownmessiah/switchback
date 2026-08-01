import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ApplicationStatusCard } from '@/app/vendor/(dashboard)/settings/application-status-card'

afterEach(() => cleanup())

/**
 * A rejected Vendor used to be told nothing at all: the decision existed only
 * in audit_logs, which they cannot see. They would keep drafting listings and
 * never learn why nothing could go live.
 *
 * This card is the Vendor's side of the accept/reject workflow — it must state
 * the decision, the reason when there is one, and what they can do next.
 */

describe('ApplicationStatusCard', () => {
  it('tells a pending Vendor a review is in progress', () => {
    render(<ApplicationStatusCard status="pending" reason={null} decidedAt={null} />)

    // Stated in both the badge and the headline — either satisfies the intent.
    expect(screen.getAllByText(/under review/i).length).toBeGreaterThan(0)
  })

  it('tells a pending Vendor they can draft while they wait', () => {
    render(<ApplicationStatusCard status="pending" reason={null} decidedAt={null} />)

    expect(screen.getByText(/draft/i)).toBeInTheDocument()
  })

  it('confirms to an approved Vendor that listings can go live', () => {
    render(
      <ApplicationStatusCard
        status="approved"
        reason={null}
        decidedAt={new Date('2026-08-01T10:00:00Z')}
      />,
    )

    expect(screen.getAllByText(/approved/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/can now go live/i)).toBeInTheDocument()
  })

  it('gives a rejected Vendor the admin reason verbatim', () => {
    render(
      <ApplicationStatusCard
        status="rejected"
        reason="PAN does not match the submitted name."
        decidedAt={new Date('2026-08-01T10:00:00Z')}
      />,
    )

    expect(screen.getByText('PAN does not match the submitted name.')).toBeInTheDocument()
  })

  it('tells a rejected Vendor they can fix it and re-apply', () => {
    render(
      <ApplicationStatusCard
        status="rejected"
        reason="PAN does not match the submitted name."
        decidedAt={new Date('2026-08-01T10:00:00Z')}
      />,
    )

    expect(screen.getByText(/re-?apply|resubmit|again/i)).toBeInTheDocument()
  })

  it('does not invent a reason when the admin gave none', () => {
    render(
      <ApplicationStatusCard
        status="rejected"
        reason={null}
        decidedAt={new Date('2026-08-01T10:00:00Z')}
      />,
    )

    expect(screen.queryByTestId('application-decision-reason')).not.toBeInTheDocument()
  })
})
