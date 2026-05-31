import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { CommissionSnapshot } from '@/app/admin/_components/commission-snapshot'

afterEach(() => {
  cleanup()
})

// The Commission Snapshot (CONTEXT.md: Payout = gross − commission − GST − TDS
// − TCS = net) is the load-bearing breakdown for the payout queue. DESIGN.md
// §4 B6 + #58-B: the decomposition must be co-present with the approve action.
// All money is right-aligned tabular-nums (DESIGN.md §1.3).

describe('CommissionSnapshot (Gross → Commission → GST → TDS → TCS → Net)', () => {
  const props = {
    grossRupees: 13000,
    commissionRupees: 2600,
    commissionRatePercent: '20.00',
    gstOnCommissionRupees: 468,
    tdsRupees: 13,
    tcsRupees: 65,
    netPayoutRupees: 9854,
  }

  it('renders every line of the snapshot waterfall', () => {
    render(<CommissionSnapshot {...props} />)
    expect(screen.getByText('Commission Snapshot')).toBeInTheDocument()
    // Each waterfall line is present via its unique testid value.
    expect(screen.getByTestId('snapshot-gross')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-commission')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-gst')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-tds')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-tcs')).toBeInTheDocument()
    expect(screen.getByTestId('snapshot-net')).toBeInTheDocument()
    // Labelled lines for the statutory deductions.
    expect(screen.getByText(/GST on commission/)).toBeInTheDocument()
    expect(screen.getByText(/TDS/)).toBeInTheDocument()
    expect(screen.getByText(/TCS/)).toBeInTheDocument()
    expect(screen.getByText(/Net Vendor Payout/)).toBeInTheDocument()
  })

  it('renders the exact net figure in tabular-nums', () => {
    render(<CommissionSnapshot {...props} />)
    const net = screen.getByTestId('snapshot-net')
    expect(net).toHaveTextContent('₹9,854')
    expect(net.className).toContain('tabular-nums')
  })

  it('renders gross and each deduction in tabular-nums', () => {
    render(<CommissionSnapshot {...props} />)
    expect(screen.getByTestId('snapshot-gross')).toHaveTextContent('₹13,000')
    expect(screen.getByTestId('snapshot-commission')).toHaveTextContent('₹2,600')
    expect(screen.getByTestId('snapshot-gst')).toHaveTextContent('₹468')
    expect(screen.getByTestId('snapshot-tds')).toHaveTextContent('₹13')
    expect(screen.getByTestId('snapshot-tcs')).toHaveTextContent('₹65')
    expect(screen.getByTestId('snapshot-gross').className).toContain('tabular-nums')
  })

  it('shows the commission rate alongside the commission line', () => {
    render(<CommissionSnapshot {...props} />)
    expect(screen.getByText(/20\.0/)).toBeInTheDocument()
  })
})
