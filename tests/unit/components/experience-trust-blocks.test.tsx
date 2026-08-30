import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Issue 13 — PDP trust/clarity blocks.
 *
 * Two new presentational blocks added to the Experience detail page WITHOUT
 * reordering the overhauled "Airbnb-style" PDP (DECISION D11):
 *
 *   1. ExperienceDisclosure  — third-party Vendor disclosure near the booking box.
 *   2. ExperienceAfterBooking — the "What happens after booking?" 5-step section.
 *
 * Both are pure Server Components that take already-translated strings (the PDP
 * resolves translations in page.tsx, like BookingRail). They carry NO client
 * directive, so they render in the server HTML and are crawlable.
 *
 * DOMAIN GUARDRAILS asserted here:
 *   - The disclosure NOUN is "Vendor" — NEVER "operator" (CONTEXT.md).
 *   - The 5 after-booking steps render in order, in an <ol> (assistive-tech
 *     ordering), with the Instant Confirmation (ADR-0003) + Advance (ADR-0001)
 *     vocabulary intact.
 */

import {
  ExperienceAfterBooking,
  ExperienceDisclosure,
} from '@/app/[locale]/(marketing)/experience/[slug]/experience-trust-blocks'

afterEach(() => {
  cleanup()
})

const DISCLOSURE = {
  heading: 'How Switchback works with Vendors',
  body:
    'All Experiences are operated by independent third-party Vendors. Switchback verifies vendor information, booking rules, and payment flow where applicable.',
}

const AFTER_BOOKING = {
  heading: 'What happens after booking?',
  steps: [
    'Select your date and participants.',
    'Pay the 25% Advance securely (Partial pay).',
    'Switchback confirms instantly.',
    'Receive the meeting point and Vendor details.',
    'The Vendor conducts the Experience as per the listed terms.',
  ],
}

describe('ExperienceDisclosure — third-party Vendor disclosure (issue 13)', () => {
  it('renders the disclosure copy with a heading', () => {
    render(<ExperienceDisclosure {...DISCLOSURE} />)
    expect(screen.getByText(DISCLOSURE.heading)).toBeTruthy()
    expect(screen.getByText(DISCLOSURE.body)).toBeTruthy()
  })

  it('uses "Vendor" as the noun and never the word "operator"', () => {
    const { container } = render(<ExperienceDisclosure {...DISCLOSURE} />)
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).toContain('vendor')
    expect(text).not.toContain('operator')
  })

  it('is server-renderable: produces no client-only markers and carries the disclosure landmark', () => {
    const { container } = render(<ExperienceDisclosure {...DISCLOSURE} />)
    // A stable hook the PDP + E2E target.
    expect(container.querySelector('[data-slot="vendor-disclosure"]')).toBeTruthy()
  })
})

describe('ExperienceAfterBooking — "What happens after booking?" (issue 13)', () => {
  it('renders inside a labelled section with the heading', () => {
    render(<ExperienceAfterBooking {...AFTER_BOOKING} />)
    expect(screen.getByText(AFTER_BOOKING.heading)).toBeTruthy()
  })

  it('renders the five steps in order as an ordered list', () => {
    const { container } = render(<ExperienceAfterBooking {...AFTER_BOOKING} />)
    const ol = container.querySelector('ol')
    expect(ol).toBeTruthy()
    const items = Array.from(within(ol!).getAllByRole('listitem'))
    expect(items).toHaveLength(5)
    expect(items.map((li) => li.textContent)).toEqual(AFTER_BOOKING.steps)
  })

  it('keeps domain vocabulary (Advance / Partial pay / instantly) and avoids "operator"', () => {
    const { container } = render(<ExperienceAfterBooking {...AFTER_BOOKING} />)
    const text = (container.textContent ?? '').toLowerCase()
    expect(text).toContain('advance')
    expect(text).toContain('partial pay')
    expect(text).toContain('instantly')
    expect(text).toContain('vendor')
    expect(text).not.toContain('operator')
  })
})
