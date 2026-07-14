import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Home-redesign issue 10 — the hero date selector (ADR-0020 front-end).
 *
 * The @base-ui popover SHELL is exercised in e2e (jsdom has no precedent for
 * base-ui portal popups in this repo); all selection logic lives in the
 * directly-testable `DatePanel`:
 *   - quick pills Today / Tomorrow / Next weekend (UTC day keys);
 *   - a 2-month grid (current + next month) built on monthCells/dateKey;
 *   - past days disabled (the UI half of ADR-0020's "reject past dates");
 *   - "Anytime" clears the selection (null).
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      `${ns}.${key}`,
  useLocale: () => 'en',
}))

import {
  DatePanel,
  quickPillDates,
} from '@/components/search/date-popover'

afterEach(() => cleanup())

// 2026-07-14 is a Tuesday.
const TODAY = new Date('2026-07-14T00:00:00.000Z')

describe('quickPillDates (pure)', () => {
  it('computes today, tomorrow, and the next Saturday (UTC)', () => {
    expect(quickPillDates(TODAY)).toEqual({
      today: '2026-07-14',
      tomorrow: '2026-07-15',
      nextWeekend: '2026-07-18',
    })
  })

  it('from a Saturday, next weekend is the FOLLOWING Saturday', () => {
    expect(quickPillDates(new Date('2026-07-18T00:00:00.000Z')).nextWeekend).toBe(
      '2026-07-25',
    )
  })

  it('from a Friday, next weekend is tomorrow', () => {
    expect(quickPillDates(new Date('2026-07-17T00:00:00.000Z')).nextWeekend).toBe(
      '2026-07-18',
    )
  })
})

describe('DatePanel', () => {
  function setup(value: string | null = null) {
    const onSelect = vi.fn()
    const utils = render(
      <DatePanel value={value} onSelect={onSelect} today={TODAY} />,
    )
    return { onSelect, ...utils }
  }

  it('renders the three quick pills + Anytime', () => {
    setup()
    expect(screen.getByRole('button', { name: 'HomeSearch.date.today' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HomeSearch.date.tomorrow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HomeSearch.date.nextWeekend' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'HomeSearch.date.anytime' })).toBeInTheDocument()
  })

  it('pills select the right UTC day; Anytime clears', () => {
    const { onSelect } = setup('2026-07-20')
    fireEvent.click(screen.getByRole('button', { name: 'HomeSearch.date.tomorrow' }))
    expect(onSelect).toHaveBeenLastCalledWith('2026-07-15')
    fireEvent.click(screen.getByRole('button', { name: 'HomeSearch.date.nextWeekend' }))
    expect(onSelect).toHaveBeenLastCalledWith('2026-07-18')
    fireEvent.click(screen.getByRole('button', { name: 'HomeSearch.date.anytime' }))
    expect(onSelect).toHaveBeenLastCalledWith(null)
  })

  it('renders a 2-month grid (current + next) with weekday headers', () => {
    const { container } = setup()
    const months = container.querySelectorAll('[data-testid="date-month"]')
    expect(months).toHaveLength(2)
    expect(screen.getByText('July 2026')).toBeInTheDocument()
    expect(screen.getByText('August 2026')).toBeInTheDocument()
  })

  it('disables past days, enables today and future days', () => {
    const { container } = setup()
    // Grid day buttons carry the raw UTC key on data-day (the accessible
    // name is the LOCALIZED full date for AT users).
    const day = (key: string): HTMLButtonElement =>
      container.querySelector(`[data-day="${key}"]`)!
    expect(day('2026-07-13')).toBeDisabled()
    expect(day('2026-07-14')).toBeEnabled()
    expect(day('2026-08-31')).toBeEnabled()
    expect(day('2026-07-14').getAttribute('aria-label')).toContain('July')
  })

  it('clicking a grid day selects that UTC day key', () => {
    const { onSelect, container } = setup()
    fireEvent.click(container.querySelector('[data-day="2026-08-05"]')!)
    expect(onSelect).toHaveBeenLastCalledWith('2026-08-05')
  })

  it('marks the selected day aria-pressed=true, unselected days false', () => {
    const { container } = setup('2026-07-20')
    expect(container.querySelector('[data-day="2026-07-20"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(container.querySelector('[data-day="2026-07-21"]')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})
