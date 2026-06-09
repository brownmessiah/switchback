import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import HomeLoading from '@/app/[locale]/(marketing)/loading'
import PdpLoading from '@/app/[locale]/(marketing)/experience/[slug]/loading'
import DestinationLoading from '@/app/[locale]/(marketing)/destinations/[slug]/loading'
import ActivityLoading from '@/app/[locale]/(marketing)/activities/[slug]/loading'

afterEach(() => cleanup())

/**
 * Each route-level loading.tsx must render a non-blank skeleton (a set of
 * Skeleton primitives, identified by data-slot="skeleton") so the server render
 * never leaves a blank screen (issue 25 acceptance: "no blank screens").
 */
describe('route loading.tsx skeletons', () => {
  it('home loading renders multiple skeleton blocks', () => {
    const { container } = render(<HomeLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(2)
  })

  it('PDP loading renders a booking-rail-shaped skeleton + content skeletons', () => {
    const { container } = render(<PdpLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })

  it('destination loading renders a hero + results grid skeleton', () => {
    const { container } = render(<DestinationLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })

  it('activity loading renders a hero + results grid skeleton', () => {
    const { container } = render(<ActivityLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })
})
