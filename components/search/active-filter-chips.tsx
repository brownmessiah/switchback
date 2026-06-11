'use client'

import type { ReactElement } from 'react'
import { X } from 'lucide-react'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import {
  deriveActiveFilterChips,
  type ActiveFilterChip,
} from '@/lib/search/active-filter-chips'
import { humanizeSlug, slugToI18nKey } from '@/lib/search/facet-options'
import type { SearchExperiencesParams } from '@/lib/search/search-experiences'

interface ActiveFilterChipsProps {
  /** The parsed search params — the single source for which chips render. */
  parsed: SearchExperiencesParams
}

/**
 * The removable active-filter chip row (issue 10), rendered above the result
 * list. One chip per APPLIED filter (derived purely by
 * `deriveActiveFilterChips`); dismissing a chip deletes ONLY that filter's
 * searchParam(s) and navigates, so the server re-renders the narrowed results.
 *
 * Each chip is a real `<button>` carrying an accessible "Remove {filter}" label
 * (icon-only X is never the sole affordance — axe 4.1.2). Labels are localised:
 * slug/enum-valued chips resolve their option label against the SAME i18n
 * namespaces the facet form uses, so no English leaks here.
 *
 * There is deliberately NO "Instant confirmation" chip — it is universally true
 * (ADR-0003) and stays a trust BADGE only (issue 05).
 */
export function ActiveFilterChips({ parsed }: ActiveFilterChipsProps): ReactElement | null {
  const t = useTranslations('SearchPage')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const chips = deriveActiveFilterChips(parsed)
  if (chips.length === 0) return null

  function removeChip(chip: ActiveFilterChip): void {
    const sp = new URLSearchParams(searchParams.toString())
    for (const param of chip.removeParams) sp.delete(param)
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function chipLabel(chip: ActiveFilterChip): string {
    switch (chip.kind) {
      case 'category':
        return t(`filters.categoryOptions.${chip.value}`)
      case 'state':
        return chip.value ?? ''
      // Slug-valued chips can carry an unknown value straight from the URL
      // (stale inbound link, hand-edited query). Fall back to a humanized
      // slug rather than leaking the raw "SearchPage.…" key (QA fix pass).
      case 'region': {
        const key = `regions.${slugToI18nKey(chip.value ?? '')}`
        return t.has(key) ? t(key) : humanizeSlug(chip.value ?? '')
      }
      case 'activity': {
        const key = `activities.${slugToI18nKey(chip.value ?? '')}`
        return t.has(key) ? t(key) : humanizeSlug(chip.value ?? '')
      }
      case 'difficulty':
        return t(`filters.difficultyOptions.${chip.value}`)
      case 'durationBand':
        return t(`filters.durationBands.${chip.value}`)
      case 'season':
        return t(`filters.months.${chip.seasonMonth}`)
      case 'groupSize':
        return t('activeFilters.groupSize', { count: chip.groupSize ?? 0 })
      case 'price':
        if (chip.priceMin !== undefined && chip.priceMax !== undefined) {
          return t('activeFilters.priceRange', { min: chip.priceMin, max: chip.priceMax })
        }
        if (chip.priceMin !== undefined) {
          return t('activeFilters.priceMin', { min: chip.priceMin })
        }
        return t('activeFilters.priceMax', { max: chip.priceMax ?? 0 })
      case 'rating':
        return t('activeFilters.rating', { rating: chip.ratingValue ?? 0 })
      case 'safety':
        return t('activeFilters.safety')
      case 'cancellation':
        return t('activeFilters.cancellation')
    }
  }

  return (
    <div
      data-testid="active-filter-chips"
      className="mb-4 flex flex-wrap items-center gap-2"
      aria-label={t('activeFilters.label')}
    >
      <span className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
        {t('activeFilters.label')}
      </span>
      {chips.map((chip) => {
        const label = chipLabel(chip)
        return (
          <Badge
            key={chip.key}
            variant="secondary"
            data-testid={`active-filter-chip-${chip.kind}`}
            render={
              <button
                type="button"
                onClick={() => removeChip(chip)}
                aria-label={t('activeFilters.remove', { filter: label })}
              />
            }
            className="min-tap gap-1 pr-1.5 hover:bg-muted"
          >
            {label}
            <X aria-hidden="true" className="size-3" />
          </Badge>
        )
      })}
    </div>
  )
}
