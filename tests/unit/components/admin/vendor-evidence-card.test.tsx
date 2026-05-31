import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { VendorEvidenceCard } from '@/app/admin/vendors/[id]/vendor-evidence-card'

// #101 — the Evidence Cockpit's left-pane document cards. Each card surfaces ONE
// real KYC evidence field on vendor_profiles and renders its state explicitly:
//   - "verified"      → a verification timestamp is present (aadhaarVerifiedAt /
//                        videoCallVerifiedAt). Affirmative.
//   - "submitted"     → a value string is present (pan / gstin / udyamId) but no
//                        verification timestamp. Awaiting review.
//   - "not submitted" → the field is null → an EXPLICIT empty state, never a bare
//                        em-dash (the load-bearing "before" defect) and never a
//                        fabricated value.
// State is conveyed by the shared AdminStatusBadge (colour + paired icon, never
// colour alone — DESIGN.md §1.3 / §5).

afterEach(() => cleanup())

describe('VendorEvidenceCard', () => {
  it('renders a value-bearing field (PAN) as "Submitted" with its value visible', () => {
    render(
      <VendorEvidenceCard
        testId="evidence-pan"
        label="PAN"
        kind="value"
        value="ABCDE1234F"
      />,
    )
    const card = screen.getByTestId('evidence-pan')
    // The actual submitted value is reviewable (fixes "no evidence to review").
    expect(within(card).getByText('ABCDE1234F')).toBeInTheDocument()
    // State badge says Submitted (awaiting review), not Verified.
    const badge = within(card).getByTestId('evidence-pan-state')
    expect(badge).toHaveTextContent('Submitted')
  })

  it('renders a null value-field (GSTIN) as an explicit "Not submitted" state — never a bare em-dash', () => {
    render(
      <VendorEvidenceCard
        testId="evidence-gstin"
        label="GSTIN"
        kind="value"
        value={null}
      />,
    )
    const card = screen.getByTestId('evidence-gstin')
    expect(within(card).getByTestId('evidence-gstin-state')).toHaveTextContent(
      'Not submitted',
    )
    // The defect being fixed: a bare em-dash must NOT be the rendered evidence.
    expect(card.textContent).not.toContain('—')
  })

  it('renders a timestamp field with a date (Aadhaar) as "Verified" with the verification date visible', () => {
    const verifiedAt = new Date('2026-03-14T09:30:00Z')
    render(
      <VendorEvidenceCard
        testId="evidence-aadhaar"
        label="Aadhaar"
        kind="timestamp"
        verifiedAt={verifiedAt}
      />,
    )
    const card = screen.getByTestId('evidence-aadhaar')
    expect(within(card).getByTestId('evidence-aadhaar-state')).toHaveTextContent(
      'Verified',
    )
    // The verification date is the reviewable evidence.
    expect(within(card).getByText(/14 Mar 2026/)).toBeInTheDocument()
  })

  it('renders a null timestamp field (Video call) as an explicit "Not submitted" state', () => {
    render(
      <VendorEvidenceCard
        testId="evidence-videocall"
        label="Video call"
        kind="timestamp"
        verifiedAt={null}
      />,
    )
    const card = screen.getByTestId('evidence-videocall')
    expect(within(card).getByTestId('evidence-videocall-state')).toHaveTextContent(
      'Not submitted',
    )
    expect(card.textContent).not.toContain('—')
  })
})
