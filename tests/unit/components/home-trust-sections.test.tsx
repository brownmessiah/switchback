import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Issue 08 — Homepage trust + "How Outvers Works" sections.
 *
 * Both sections are extracted as pure, props-free presentational components so
 * they can be rendered in jsdom (the home page itself is a Server Component
 * that hits the DB). Translation keys are returned verbatim by the mock, so we
 * assert by stable i18n key — never by translated copy.
 *
 * DECISION D0 (data honesty): the cards/steps must NEVER carry fabricated
 * metrics ("40,000+", "500+ vendors") or over-promising safety language
 * ("guaranteed", "fully insured"). These tests lock that in by scanning the
 * rendered text.
 */

vi.mock('next-intl', () => ({
  useTranslations:
    (ns: string) =>
    (key: string) =>
      ns ? `${ns}.${key}` : key,
}))

import { HomeHowItWorks } from '@/components/home/how-it-works'
import { HomeTrust } from '@/components/home/trust'

afterEach(() => {
  cleanup()
})

// The six trust-card keys, in render order. Each is a descriptive feature
// category backed by real product behaviour — NOT a numeric claim.
const TRUST_CARD_KEYS = [
  'verifiedVendors',
  'transparentPricing',
  'safetyFirst',
  'bookingSupport',
  'instantConfirmation',
  'secureCheckout',
] as const

// The five "How Outvers Works" steps, in order.
const STEP_KEYS = [
  'search',
  'compare',
  'selectSlot',
  'paySecurely',
  'confirmation',
] as const

// Strings that must NEVER appear in either section (fabricated metrics or
// over-promising claims). Matched case-insensitively against rendered text.
const FORBIDDEN_SUBSTRINGS = [
  'guaranteed',
  'fully insured',
  '40,000',
  '500+',
  'operator',
]

describe('HomeTrust — "Adventure You Can Trust" section (issue 08)', () => {
  it('renders inside a labelled <section> with a single <h2> heading', () => {
    render(<HomeTrust />)
    const region = screen.getByRole('region', {
      name: 'HomePage.trust.heading',
    })
    expect(region).toBeTruthy()
    const headings = within(region).getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('HomePage.trust.heading')
  })

  it('renders all six trust cards with their title + description', () => {
    render(<HomeTrust />)
    for (const key of TRUST_CARD_KEYS) {
      expect(
        screen.getByText(`HomePage.trust.cards.${key}.title`),
      ).toBeTruthy()
      expect(
        screen.getByText(`HomePage.trust.cards.${key}.body`),
      ).toBeTruthy()
    }
  })

  it('renders exactly six trust cards', () => {
    render(<HomeTrust />)
    const cards = screen.getAllByTestId('trust-card')
    expect(cards).toHaveLength(6)
  })

  it('renders a distinct accessible icon (aria-hidden) per card', () => {
    const { container } = render(<HomeTrust />)
    const cards = Array.from(
      container.querySelectorAll('[data-testid="trust-card"]'),
    )
    const iconHtml = cards.map((c) => {
      const svg = c.querySelector('svg')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      return svg?.innerHTML
    })
    // All six icons are distinct (no copy-paste icon reuse).
    expect(new Set(iconHtml).size).toBe(6)
  })

  it('does not emit fabricated metrics or over-promising claims', () => {
    const { container } = render(<HomeTrust />)
    const text = (container.textContent ?? '').toLowerCase()
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(text).not.toContain(forbidden.toLowerCase())
    }
  })
})

describe('HomeHowItWorks — "How Outvers Works" section (issue 08)', () => {
  it('renders inside a labelled <section> with a single <h2> heading', () => {
    render(<HomeHowItWorks />)
    const region = screen.getByRole('region', {
      name: 'HomePage.howItWorks.heading',
    })
    expect(region).toBeTruthy()
    const headings = within(region).getAllByRole('heading', { level: 2 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('HomePage.howItWorks.heading')
  })

  it('renders the five steps in order as an ordered list', () => {
    const { container } = render(<HomeHowItWorks />)
    // Ordered semantics: an <ol> conveys the sequence to assistive tech.
    const ol = container.querySelector('ol')
    expect(ol).toBeTruthy()
    const items = Array.from(
      container.querySelectorAll('[data-testid="how-step"]'),
    )
    expect(items).toHaveLength(5)
    const titles = items.map(
      (li) => li.querySelector('[data-slot="step-title"]')?.textContent,
    )
    expect(titles).toEqual(
      STEP_KEYS.map((k) => `HomePage.howItWorks.steps.${k}.title`),
    )
  })

  it('renders each step with a title + description', () => {
    render(<HomeHowItWorks />)
    for (const key of STEP_KEYS) {
      expect(
        screen.getByText(`HomePage.howItWorks.steps.${key}.title`),
      ).toBeTruthy()
      expect(
        screen.getByText(`HomePage.howItWorks.steps.${key}.body`),
      ).toBeTruthy()
    }
  })

  it('numbers the steps 1..5 for visual sequence', () => {
    render(<HomeHowItWorks />)
    const numbers = screen
      .getAllByTestId('how-step')
      .map((li) => within(li).getByTestId('step-number').textContent)
    expect(numbers).toEqual(['1', '2', '3', '4', '5'])
  })

  it('does not emit fabricated metrics or over-promising claims', () => {
    const { container } = render(<HomeHowItWorks />)
    const text = (container.textContent ?? '').toLowerCase()
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(text).not.toContain(forbidden.toLowerCase())
    }
  })
})
