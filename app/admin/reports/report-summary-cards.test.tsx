/**
 * Token-true report summary cards (#105).
 *
 * DESIGN.md §2.2: every column of figures (money + counts) renders in
 * `.tabular-nums`; money uses the shared admin `formatRupees` (₹, en-IN,
 * integer rupees). These tests pin the summary band to those tokens so the
 * reports surface stays consistent with the dashboard/analytics money idiom.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { ReportSummaryCards } from './report-summary-cards'

afterEach(cleanup)

const SUMMARY = {
  totalUsers: 1234,
  totalVendors: 56,
  totalExperiences: 789,
  totalBookings: 4321,
  totalRevenue: 9876543,
} as const

describe('ReportSummaryCards', () => {
  it('renders the revenue figure as ₹ en-IN integer rupees', () => {
    const { getByTestId } = render(<ReportSummaryCards summary={SUMMARY} />)
    expect(getByTestId('report-total-revenue').textContent).toBe('₹98,76,543')
  })

  it('renders every figure with the .tabular-nums money/count token', () => {
    const { getByTestId } = render(<ReportSummaryCards summary={SUMMARY} />)
    for (const id of [
      'report-total-revenue',
      'report-total-bookings',
      'report-total-users',
      'report-total-vendors',
      'report-total-experiences',
    ]) {
      expect(getByTestId(id).className).toContain('tabular-nums')
    }
  })

  it('keeps the five exact KPI labels the surface promises', () => {
    const { getByText } = render(<ReportSummaryCards summary={SUMMARY} />)
    for (const label of [
      'Total revenue',
      'Total bookings',
      'Total users',
      'Total vendors',
      'Total experiences',
    ]) {
      expect(getByText(label)).toBeTruthy()
    }
  })
})
