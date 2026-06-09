import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CompareView } from '@/components/compare/view'
import type { ComparisonRow } from '@/lib/compare/dataset'
import { COMPARE_STORAGE_KEY } from '@/lib/compare/storage'

// next-intl: t() returns the key (with simple {placeholder} passthrough) so we
// assert on the i18n keys / labels.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// next/link passthrough.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

function row(overrides: Partial<ComparisonRow> & { slug: string }): ComparisonRow {
  const { slug } = overrides
  const base: ComparisonRow = {
    id: slug,
    slug,
    title: `Title ${slug}`,
    priceBrackets: { from1to2: 2000, from3to5: 1800, from6plus: 1600 },
    durationMinutes: 240,
    difficulty: 'moderate',
    inclusions: ['Helmet', 'Guide'],
    cancellationPreset: 'flexible',
    ratingAvg: 4.5,
    ratingCount: 12,
    vendorKycTier: 'identity',
    minAge: 12,
    vendorName: 'Ganga Rafting Co',
    vendorSlug: 'ganga-rafting-co',
  }
  return { ...base, ...overrides }
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})
beforeEach(() => {
  window.localStorage.clear()
})

describe('CompareView empty state', () => {
  it('renders the empty prompt (and no table) when nothing is selected', async () => {
    const fetchDataset = vi.fn(async () => [] as ComparisonRow[])
    render(<CompareView fetchDataset={fetchDataset} />)
    await waitFor(() => {
      expect(screen.getByTestId('compare-empty')).toBeTruthy()
    })
    expect(screen.queryByTestId('compare-table')).toBeNull()
    // No stored slugs → the fetcher is never called.
    expect(fetchDataset).not.toHaveBeenCalled()
  })

  it('renders the empty prompt when the stored slugs resolve to no visible rows', async () => {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['stale-draft']))
    const fetchDataset = vi.fn(async () => [] as ComparisonRow[])
    render(<CompareView fetchDataset={fetchDataset} />)
    await waitFor(() => {
      expect(fetchDataset).toHaveBeenCalledWith(['stale-draft'])
    })
    await waitFor(() => {
      expect(screen.getByTestId('compare-empty')).toBeTruthy()
    })
  })
})

describe('CompareView table', () => {
  beforeEach(() => {
    window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['a', 'b']))
  })

  function renderWith(rows: ComparisonRow[]) {
    const fetchDataset = vi.fn(async () => rows)
    render(<CompareView fetchDataset={fetchDataset} />)
    return fetchDataset
  }

  it('renders one column per resolved row, with the titles', async () => {
    renderWith([row({ slug: 'a' }), row({ slug: 'b' })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    expect(screen.getByText('Title a')).toBeTruthy()
    expect(screen.getByText('Title b')).toBeTruthy()
  })

  it('renders all ten field-row labels', async () => {
    renderWith([row({ slug: 'a' })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    for (const labelKey of [
      'fields.price',
      'fields.duration',
      'fields.difficulty',
      'fields.inclusions',
      'fields.cancellation',
      'fields.rating',
      'fields.kyc',
      'fields.minAge',
      'fields.groupSize',
      'fields.vendor',
    ]) {
      expect(screen.getByText(labelKey)).toBeTruthy()
    }
  })

  it('labels the flexible preset as a cancellation preset, NEVER "free"', async () => {
    renderWith([row({ slug: 'a', cancellationPreset: 'flexible' })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    // The cell renders the preset key, not the word "free".
    expect(screen.getByText('cancellation.flexible')).toBeTruthy()
    expect(screen.queryByText(/free/i)).toBeNull()
  })

  it('renders the KYC verified label for an identity-verified vendor', async () => {
    renderWith([row({ slug: 'a', vendorKycTier: 'identity' })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    expect(screen.getByText('kyc.identity')).toBeTruthy()
  })

  it('links the Vendor cell to the storefront /vendor/{slug}', async () => {
    renderWith([row({ slug: 'a', vendorSlug: 'ganga-rafting-co', vendorName: 'Ganga Rafting Co' })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    const vendorLink = screen
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === '/vendor/ganga-rafting-co')
    expect(vendorLink).toBeTruthy()
    expect(vendorLink!.textContent).toContain('Ganga Rafting Co')
  })

  it('renders the three group-size price brackets', async () => {
    renderWith([
      row({ slug: 'a', priceBrackets: { from1to2: 2000, from3to5: 1800, from6plus: 1600 } }),
    ])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    // Rupee-formatted bracket values appear in the price cell.
    expect(screen.getByText(/2,000/)).toBeTruthy()
    expect(screen.getByText(/1,800/)).toBeTruthy()
    expect(screen.getByText(/1,600/)).toBeTruthy()
  })

  it('handles a nullable field (no difficulty) without crashing', async () => {
    renderWith([row({ slug: 'a', difficulty: null, minAge: null, inclusions: [] })])
    await waitFor(() => {
      expect(screen.getByTestId('compare-table')).toBeTruthy()
    })
    // A dash / "not specified" key renders instead of a value.
    expect(screen.getAllByText('fields.notSpecified').length).toBeGreaterThan(0)
  })
})
