import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Unified hero search bar (home-redesign issue 07 / CR5+CR7):
 * `[Destination or activity] [participants stepper] [Search]` in ONE
 * responsive pill bar.
 *
 * Contract:
 *   - Still a plain GET form to /search (role=search, crawlable): the `q`
 *     field submits with ZERO JS — progressive enhancement, the WebSite
 *     JSON-LD SearchAction (/search?q=) stays truthful.
 *   - The participants stepper wires to the EXISTING groupSize param
 *     (parseSearchParams → maxGroupSize "fits a group of N" filter). At the
 *     default (1) NO groupSize input is emitted, so the no-JS submit and the
 *     canonical /search?q= URL shape are unchanged.
 *   - The date segment (issue 10, ADR-0020): popover trigger + hidden
 *     `date` input only when a day is picked — the default submit stays
 *     /search?q=.
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      values ? `${ns}.${key}:${JSON.stringify(values)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import { HomeHeroSearch } from '@/components/home/hero-search'

const ROOT = resolve(__dirname, '../../..')

afterEach(() => cleanup())

describe('HomeHeroSearch — unified bar (issue 07)', () => {
  it('remains a crawlable GET form to /search with the q searchbox', () => {
    const { container } = render(<HomeHeroSearch />)

    const form = container.querySelector('form')
    expect(form).toHaveAttribute('action', '/search')
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('data-testid', 'home-hero-search')

    const input = screen.getByRole('searchbox', {
      name: 'HomeSearch.single.label',
    })
    expect(input).toHaveAttribute('name', 'q')
    expect(input).toHaveAttribute(
      'placeholder',
      'HomeSearch.single.placeholder',
    )
  })

  it('stays stacked until md — the row layout is too cramped at sm (640px)', () => {
    // Measured 2026-07-14: at exactly 640px the single-row pill leaves the
    // query input just 118px (53px in Tamil) — every placeholder ellipsizes.
    // Airbnb's segmented pill stacks on narrow screens for the same reason;
    // the row starts at md (768px), where the en placeholder fits (182px).
    const { container } = render(<HomeHeroSearch />)
    const pill = container.querySelector('form > div')
    expect(pill?.className).toContain('md:flex-row')
    expect(pill?.className).not.toContain('sm:flex-row')
    // The segment dividers flip orientation at the SAME breakpoint.
    expect(container.innerHTML).not.toContain('sm:border-l')
  })

  it('guards long-locale placeholders with an ellipsis backstop (placeholder:truncate)', () => {
    // Some locales (e.g. Tamil) translate the placeholder well past the field
    // width; ::placeholder gets no ellipsis from the browser, so the input
    // carries the truncate backstop (graceful "…" where engines support it).
    render(<HomeHeroSearch />)
    const input = screen.getByRole('searchbox', {
      name: 'HomeSearch.single.label',
    })
    expect(input.className).toContain('placeholder:truncate')
  })

  it('has a labelled submit button', () => {
    render(<HomeHeroSearch />)
    expect(
      screen.getByRole('button', { name: 'HomeSearch.single.submit' }),
    ).toBeInTheDocument()
  })

  it('renders the participants stepper wired to groupSize (hidden until > 1)', () => {
    const { container } = render(<HomeHeroSearch />)

    // Default: 1 participant — NO groupSize input in the form (canonical
    // /search?q= URL shape; no-JS fallback identical to the old bar).
    expect(container.querySelector('input[name="groupSize"]')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'HomeSearch.fields.groupSize +' }),
    )
    const hidden = container.querySelector<HTMLInputElement>(
      'input[name="groupSize"]',
    )
    expect(hidden).not.toBeNull()
    expect(hidden?.value).toBe('2')
    expect(hidden?.type).toBe('hidden')
  })

  it('stepping back to 1 removes the groupSize input again', () => {
    const { container } = render(<HomeHeroSearch />)
    const plus = screen.getByRole('button', { name: 'HomeSearch.fields.groupSize +' })
    const minus = screen.getByRole('button', { name: 'HomeSearch.fields.groupSize −' })

    fireEvent.click(plus)
    fireEvent.click(minus)
    expect(container.querySelector('input[name="groupSize"]')).toBeNull()
  })

  it('shows a translated participant count (ICU) that tracks the stepper', () => {
    render(<HomeHeroSearch />)
    expect(
      screen.getByText('HomeSearch.participants.count:{"count":1}'),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'HomeSearch.fields.groupSize +' }),
    )
    expect(
      screen.getByText('HomeSearch.participants.count:{"count":2}'),
    ).toBeInTheDocument()
  })

  it('renders the date segment (issue 10): Anytime trigger, no date input until picked', () => {
    const { container } = render(<HomeHeroSearch />)
    // The popover trigger (accessible name = the "Date" field label) shows
    // the "Anytime" default as its visible text; the hidden `date` input
    // exists only once a day is picked (selection interaction is covered by
    // the DatePanel unit tests + the e2e — jsdom does not exercise the
    // base-ui portal popup).
    // Accessible name composes the field label WITH the current value
    // (WCAG 2.5.3 label-in-name).
    const trigger = screen.getByRole('button', {
      name: 'HomeSearch.fields.date: HomeSearch.date.anytime',
    })
    expect(trigger.textContent).toContain('HomeSearch.date.anytime')
    expect(container.querySelector('input[name="date"]')).toBeNull()
  })
})

describe('hero search copy contract (en.json)', () => {
  const en = JSON.parse(
    readFileSync(resolve(ROOT, 'lib/i18n/messages/en.json'), 'utf-8'),
  ) as {
    HomeSearch: {
      single: Record<string, string>
      participants?: Record<string, string>
    }
  }

  it('the q field reads "Destination or activity" (placeholder-truncation fix, 2026-07-14)', () => {
    // Supersedes the CR5 "Search places or activities" copy: at sm+ the query
    // field shares its row with the date/participants segments and the 27-char
    // string clipped mid-word ("…activitie"). Booking.com's segmented
    // attractions search — the same layout shape — uses this 23-char pattern.
    expect(en.HomeSearch.single.placeholder).toBe('Destination or activity')
    // Placeholder and accessible name stay IDENTICAL (WCAG 2.5.3
    // label-in-name — voice-control users speak what they see).
    expect(en.HomeSearch.single.label).toBe(en.HomeSearch.single.placeholder)
  })

  it('placeholder stays within the segmented-field budget (≤ 25 chars)', () => {
    // Length budgeting at copy time is the primary defense against silent
    // placeholder clipping (browsers add no ellipsis to ::placeholder).
    expect(en.HomeSearch.single.placeholder.length).toBeLessThanOrEqual(25)
  })

  it('participants.count is an ICU plural over {count}', () => {
    const count = en.HomeSearch.participants?.count ?? ''
    expect(count).toContain('{count, plural,')
    expect(count).toContain('one')
    expect(count).toContain('other')
  })
})
