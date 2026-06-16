import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import DestinationLoading from '@/app/[locale]/(marketing)/destinations/[slug]/loading'
import ActivityLoading from '@/app/[locale]/(marketing)/activities/[slug]/loading'

afterEach(() => cleanup())

/**
 * Each route-level loading.tsx must render a non-blank skeleton (a set of
 * Skeleton primitives, identified by data-slot="skeleton") so the server render
 * never leaves a blank screen (issue 25 acceptance: "no blank screens").
 *
 * NOTE: the group-level (marketing)/loading.tsx (home skeleton) and the
 * experience/[slug]/loading.tsx (PDP skeleton) were REMOVED — their Suspense
 * boundaries streamed a 200 shell before the page body / generateMetadata
 * notFound() resolved, turning dead slugs into soft-404s (HTTP 200 instead of
 * 404). The destinations + activities loaders survive because those routes use
 * `dynamicParams = false`: an unknown slug 404s at the routing level (before any
 * render or stream), so their skeleton can safely remain for valid slugs.
 */
describe('route loading.tsx skeletons', () => {
  it('destination loading renders a hero + results grid skeleton', () => {
    const { container } = render(<DestinationLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })

  it('activity loading renders a hero + results grid skeleton', () => {
    const { container } = render(<ActivityLoading />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3)
  })
})
