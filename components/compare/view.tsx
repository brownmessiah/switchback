'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'

import { useTranslations } from 'next-intl'
import { BadgeCheck, Star } from 'lucide-react'

import { useCompareSelection } from '@/components/compare/use-compare-selection'
import type {
  CompareCancellationPreset,
  CompareDifficulty,
  CompareKycTier,
  ComparisonRow,
} from '@/lib/compare/dataset'
import { formatDuration } from '@/lib/experiences/structured-schema'

interface CompareViewProps {
  /**
   * Resolves the comparison rows for the given slugs, gated through
   * `lib/experiences/public-filter` and ordered by the visitor's selection. In
   * the app this is `loadComparisonDatasetAction`; tests inject a stub. Keeping
   * the data source injected makes the view a pure, SSR-safe client component.
   */
  fetchDataset: (slugs: string[]) => Promise<ComparisonRow[]>
}

const DIFFICULTY_KEYS: Record<CompareDifficulty, string> = {
  easy: 'difficulty.easy',
  moderate: 'difficulty.moderate',
  challenging: 'difficulty.challenging',
  extreme: 'difficulty.extreme',
}

const CANCELLATION_KEYS: Record<CompareCancellationPreset, string> = {
  flexible: 'cancellation.flexible',
  moderate: 'cancellation.moderate',
  strict: 'cancellation.strict',
  custom: 'cancellation.custom',
}

// `phone` carries no verified badge (ADR-0007) — handled inline as "none".
const KYC_VERIFIED_KEYS: Record<Exclude<CompareKycTier, 'phone'>, string> = {
  identity: 'kyc.identity',
  business: 'kyc.business',
}

/**
 * Dedicated `/compare` side-by-side view (DECISION D10).
 *
 * localStorage only exists client-side, so the view reads the compare-selected
 * slugs in an effect and resolves them to gated comparison rows via the injected
 * `fetchDataset`. The table puts FIELDS as rows and EXPERIENCES as columns; the
 * first column (field labels) is sticky and the table scrolls horizontally on
 * narrow screens, so mobile gets stacked/scrollable columns. When the selection
 * is empty (or every slug gated out), an empty prompt invites the visitor to add
 * Experiences from the catalogue.
 *
 * Re-gated server-side on every load, so a slug that has since become draft /
 * paused / archived / fixture simply drops out of the comparison (guardrail D0).
 */
export function CompareView({ fetchDataset }: CompareViewProps): ReactElement {
  const t = useTranslations('Compare')
  const { slugs, hydrated } = useCompareSelection()
  const [rows, setRows] = useState<ComparisonRow[] | null>(null)

  useEffect(() => {
    if (!hydrated) return
    let active = true
    if (slugs.length === 0) {
      setRows([])
      return
    }
    fetchDataset(slugs)
      .then((resolved) => {
        if (active) setRows(resolved)
      })
      .catch(() => {
        if (active) setRows([])
      })
    return () => {
      active = false
    }
  }, [slugs, hydrated, fetchDataset])

  // Before the first resolution we render nothing visible (avoids flashing the
  // empty state for a visitor who DOES have a selection).
  if (rows === null) return <div aria-busy="true" />

  if (rows.length === 0) {
    return (
      <div
        data-testid="compare-empty"
        className="mx-auto max-w-md rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center"
      >
        <p className="text-sm text-muted-foreground">{t('empty.body')}</p>
        <Link
          href="/search"
          className="mt-4 inline-flex min-h-[var(--tap-min,44px)] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          {t('empty.cta')}
        </Link>
      </div>
    )
  }

  const notSpecified = (
    <span className="text-muted-foreground">{t('fields.notSpecified')}</span>
  )

  // Each field is one table ROW; each Experience is one COLUMN.
  const fieldRows: { key: string; label: string; cell: (row: ComparisonRow) => ReactNode }[] = [
    {
      key: 'price',
      label: t('fields.price'),
      cell: (row) => (
        <div className="space-y-1 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t('priceBracket.from1to2')}</span>
            <span className="font-semibold tabular-nums">{rupees(row.priceBrackets.from1to2)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t('priceBracket.from3to5')}</span>
            <span className="font-semibold tabular-nums">{rupees(row.priceBrackets.from3to5)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-muted-foreground">{t('priceBracket.from6plus')}</span>
            <span className="font-semibold tabular-nums">{rupees(row.priceBrackets.from6plus)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'duration',
      label: t('fields.duration'),
      cell: (row) =>
        row.durationMinutes != null ? formatDuration(row.durationMinutes) : notSpecified,
    },
    {
      key: 'difficulty',
      label: t('fields.difficulty'),
      cell: (row) => (row.difficulty ? t(DIFFICULTY_KEYS[row.difficulty]) : notSpecified),
    },
    {
      key: 'inclusions',
      label: t('fields.inclusions'),
      cell: (row) =>
        row.inclusions.length > 0 ? (
          <ul className="list-inside list-disc space-y-0.5 text-sm">
            {row.inclusions.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          notSpecified
        ),
    },
    {
      key: 'cancellation',
      label: t('fields.cancellation'),
      // ADR-0005 — labelled "Flexible cancellation" etc, NEVER "free".
      cell: (row) => t(CANCELLATION_KEYS[row.cancellationPreset]),
    },
    {
      key: 'rating',
      label: t('fields.rating'),
      cell: (row) =>
        row.ratingCount > 0 && row.ratingAvg != null ? (
          <span className="inline-flex items-center gap-1 tabular-nums">
            <Star className="size-3.5 fill-current text-warning" aria-hidden="true" />
            {row.ratingAvg.toFixed(1)} ({row.ratingCount})
          </span>
        ) : (
          notSpecified
        ),
    },
    {
      key: 'kyc',
      label: t('fields.kyc'),
      cell: (row) =>
        row.vendorKycTier === 'phone' ? (
          notSpecified
        ) : (
          <span className="inline-flex items-center gap-1">
            <BadgeCheck className="size-4 text-success" aria-hidden="true" />
            {t(KYC_VERIFIED_KEYS[row.vendorKycTier])}
          </span>
        ),
    },
    {
      key: 'minAge',
      label: t('fields.minAge'),
      cell: (row) =>
        row.minAge != null ? t('minAgeValue', { age: row.minAge }) : notSpecified,
    },
    {
      key: 'groupSize',
      label: t('fields.groupSize'),
      // The three mandatory brackets (ADR-0011) — the same buckets the price uses.
      cell: () => t('groupSizeValue'),
    },
    {
      key: 'vendor',
      label: t('fields.vendor'),
      cell: (row) => (
        <Link href={`/vendor/${row.vendorSlug}`} className="font-medium text-primary-strong hover:underline">
          {row.vendorName}
        </Link>
      ),
    },
  ]

  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="compare-scroll">
      <table
        data-testid="compare-table"
        className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm"
      >
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 w-36 bg-background p-3 align-bottom text-xs font-medium text-muted-foreground"
            >
              <span className="sr-only">{t('fields.attribute')}</span>
            </th>
            {rows.map((row) => (
              <th
                key={row.id}
                scope="col"
                className="min-w-[12rem] border-b border-border p-3 align-bottom"
              >
                <Link
                  href={`/experience/${row.slug}`}
                  className="font-heading text-sm font-semibold leading-snug tracking-tight hover:underline"
                >
                  {row.title}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fieldRows.map((field) => (
            <tr key={field.key} data-field={field.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 bg-background p-3 align-top text-xs font-medium text-muted-foreground"
              >
                {field.label}
              </th>
              {rows.map((row) => (
                <td key={row.id} className="border-b border-border p-3 align-top">
                  {field.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Format whole rupees with Indian grouping (₹2,000). */
function rupees(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`
}
