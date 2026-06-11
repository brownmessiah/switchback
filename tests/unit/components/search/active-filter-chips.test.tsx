import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * QA fix pass: an unknown facet slug in the URL (e.g. a stale inbound link
 * `?activity=scuba` instead of the canonical `scuba-diving`) must NEVER leak a
 * raw i18n key like "SearchPage.activities.scuba" into the chip row. Known
 * slugs keep their translated label; unknown slugs fall back to a humanized
 * form of the slug itself.
 */

// Mimic next-intl's missing-key behavior: known keys translate, unknown keys
// come back as the raw `${ns}.${key}` string; `t.has()` reports membership.
const KNOWN_KEYS = new Set([
  'activities.scubaDiving',
  'regions.rishikesh',
  'activeFilters.label',
  'activeFilters.remove',
])

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => {
    const t = (key: string, values?: Record<string, unknown>) =>
      KNOWN_KEYS.has(key)
        ? `TRANSLATED:${key}${values?.filter ? `:${String(values.filter)}` : ''}`
        : `${ns}.${key}`
    t.has = (key: string) => KNOWN_KEYS.has(key)
    return t
  },
}))

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/search',
  useSearchParams: () => new URLSearchParams('activity=scuba'),
}))

import { ActiveFilterChips } from '@/components/search/active-filter-chips'
import type { SearchExperiencesParams } from '@/lib/search/search-experiences'

afterEach(() => {
  cleanup()
})

function parsedWith(overrides: Partial<SearchExperiencesParams>): SearchExperiencesParams {
  return { page: 1, ...overrides } as SearchExperiencesParams
}

describe('ActiveFilterChips — unknown-slug label fallback', () => {
  it('renders a humanized label (not the raw i18n key) for an unknown activity slug', () => {
    render(<ActiveFilterChips parsed={parsedWith({ activity: 'scuba' })} />)

    expect(screen.queryByText('SearchPage.activities.scuba')).toBeNull()
    expect(screen.getByText('Scuba')).toBeInTheDocument()
  })

  it('still renders the translated label for a canonical activity slug', () => {
    render(<ActiveFilterChips parsed={parsedWith({ activity: 'scuba-diving' })} />)

    expect(screen.getByText('TRANSLATED:activities.scubaDiving')).toBeInTheDocument()
  })

  it('humanizes unknown region slugs the same way', () => {
    render(
      <ActiveFilterChips
        parsed={parsedWith({ region: 'spiti-valley-unknown' })}
      />,
    )

    expect(screen.queryByText('SearchPage.regions.spitiValleyUnknown')).toBeNull()
    expect(screen.getByText('Spiti valley unknown')).toBeInTheDocument()
  })
})
