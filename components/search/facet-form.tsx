'use client'

import { useRef, type ReactElement } from 'react'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DURATION_BANDS } from '@/lib/search/duration-band'
import {
  ACTIVITY_OPTIONS,
  CATEGORY_OPTIONS,
  REGION_OPTIONS,
  STATE_OPTIONS,
} from '@/lib/search/facet-options'
import type { SearchExperiencesParams } from '@/lib/search/search-experiences'
import { cn } from '@/lib/utils'

/** ADR-0017 difficulty enum values — facet options + i18n key suffixes. */
const DIFFICULTY_OPTIONS = ['easy', 'moderate', 'challenging', 'extreme'] as const
/** Months 1-12 for the "runs in month" facet. */
const MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

const CHIP_BASE =
  'flex w-full items-center rounded-[var(--radius-control)] px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface FacetFormProps {
  parsed: SearchExperiencesParams
  /**
   * Disambiguates the two instances of the form on a page (the desktop rail and
   * the mobile Sheet) so their control `id`s stay unique and `<Label htmlFor>`
   * bindings remain valid for axe.
   */
  instanceId: string
}

/**
 * The faceted search filter form (DESIGN.md §4 / A1 "filter rail + filter
 * Sheet"). **Auto-filtering**: changing any control navigates immediately
 * (`router.push`) with the updated searchParam — no Apply button. The page
 * re-renders server-side with the new results; the searchParam-name contract
 * (`category`, `activity`, `region`, `state`, `difficulty`, `durationBand`,
 * `season`, `groupSize`, `sort`, `minPrice`, `maxPrice`) — which ADR-0013
 * robots/canonical rules depend on — is preserved.
 *
 * Information hierarchy (researched filter-UX best practice — Algolia/NN-group:
 * surface the few high-intent filters, progressively disclose the rest):
 *   1. Sort  2. Category (one-tap chips)  3. Destination
 *   4. "More filters" disclosure (activity + structured refinements)  5. Price
 *
 * Selects/chips navigate instantly; the free-text number inputs (price, group
 * size) debounce so we don't navigate on every keystroke.
 */
export function FacetForm({ parsed, instanceId }: FacetFormProps): ReactElement {
  const t = useTranslations('SearchPage')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const minPriceRef = useRef<HTMLInputElement>(null)
  const maxPriceRef = useRef<HTMLInputElement>(null)
  const groupRef = useRef<HTMLInputElement>(null)

  const sortId = `${instanceId}-sort`
  const activityId = `${instanceId}-activity`
  const stateId = `${instanceId}-state`
  const regionId = `${instanceId}-region`
  const minPriceId = `${instanceId}-minPrice`
  const maxPriceId = `${instanceId}-maxPrice`
  const difficultyId = `${instanceId}-difficulty`
  const durationBandId = `${instanceId}-durationBand`
  const seasonId = `${instanceId}-season`
  const groupSizeId = `${instanceId}-groupSize`

  /** Merge updates into the live query and navigate (auto-filter). */
  function navigate(updates: Record<string, string | null>): void {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') sp.delete(key)
      else sp.set(key, value)
    }
    const qs = sp.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  /** Debounced commit of the free-text number facets (price + group size). */
  function commitNumbersDebounced(): void {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      navigate({
        minPrice: minPriceRef.current?.value ?? null,
        maxPrice: maxPriceRef.current?.value ?? null,
        groupSize: groupRef.current?.value ?? null,
      })
    }, 450)
  }

  const moreActive = Boolean(
    parsed.activity ||
      parsed.difficulty ||
      parsed.durationBand ||
      parsed.seasonMonth ||
      parsed.maxGroupSize,
  )

  const categoryChips = [
    { value: '', label: t('filters.allCategories') },
    ...CATEGORY_OPTIONS.map((c) => ({
      value: c.slug,
      label: t(`filters.categoryOptions.${c.i18nKey}`),
    })),
  ]

  return (
    <div className="space-y-5">
      {/* 1 — Sort (high-intent, top) */}
      <div className="space-y-2" data-testid="facet-sort">
        <Label htmlFor={sortId}>{t('filters.sortBy')}</Label>
        <Select
          value={parsed.sort ?? 'relevance'}
          onValueChange={(v) => navigate({ sort: v === 'relevance' ? null : v })}
        >
          <SelectTrigger id={sortId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="relevance">{t('filters.relevance')}</SelectItem>
            <SelectItem value="price_asc">{t('filters.priceLowHigh')}</SelectItem>
            <SelectItem value="price_desc">{t('filters.priceHighLow')}</SelectItem>
            <SelectItem value="newest">{t('filters.newest')}</SelectItem>
            <SelectItem value="duration_asc">{t('filters.durationShortLong')}</SelectItem>
            <SelectItem value="duration_desc">{t('filters.durationLongShort')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 2 — Category (one-tap chips — the primary, easiest selector) */}
      <fieldset className="space-y-2" data-testid="facet-category">
        <legend className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
          {t('filters.category')}
        </legend>
        <div className="flex flex-col gap-1" role="group" aria-label={t('filters.category')}>
          {categoryChips.map((opt) => {
            const active = opt.value ? parsed.category === opt.value : !parsed.category
            return (
              <button
                key={opt.value || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => navigate({ category: opt.value || null })}
                className={cn(
                  CHIP_BASE,
                  active
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </fieldset>

      {/* 3 — Destination (State → City) */}
      <fieldset className="space-y-3">
        <legend className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
          {t('filters.destination')}
        </legend>
        <div className="space-y-2" data-testid="facet-state">
          <Label htmlFor={stateId}>{t('filters.state')}</Label>
          <Select
            value={parsed.state ?? ''}
            onValueChange={(v) => navigate({ state: v || null })}
          >
            <SelectTrigger id={stateId} className="w-full">
              <SelectValue placeholder={t('filters.allStates')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allStates')}</SelectItem>
              {STATE_OPTIONS.map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2" data-testid="facet-region">
          <Label htmlFor={regionId}>{t('filters.region')}</Label>
          <Select
            value={parsed.region ?? ''}
            onValueChange={(v) => navigate({ region: v || null })}
          >
            <SelectTrigger id={regionId} className="w-full">
              <SelectValue placeholder={t('filters.allRegions')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">{t('filters.allRegions')}</SelectItem>
              {REGION_OPTIONS.map((r) => (
                <SelectItem key={r.slug} value={r.slug}>
                  {t(`regions.${r.i18nKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      {/* 4 — More filters (progressive disclosure for the secondary refinements) */}
      <details open={moreActive} className="group border-t border-border pt-3">
        <summary
          data-testid="facet-more-toggle"
          className="flex cursor-pointer list-none items-center justify-between text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground hover:text-foreground"
        >
          {t('filters.moreFilters')}
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">⌄</span>
        </summary>

        <div className="space-y-4 pt-3">
          <div className="space-y-2" data-testid="facet-activity">
            <Label htmlFor={activityId}>{t('filters.activity')}</Label>
            <Select
              value={parsed.activity ?? ''}
              onValueChange={(v) => navigate({ activity: v || null })}
            >
              <SelectTrigger id={activityId} className="w-full">
                <SelectValue placeholder={t('filters.allActivities')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('filters.allActivities')}</SelectItem>
                {ACTIVITY_OPTIONS.map((a) => (
                  <SelectItem key={a.slug} value={a.slug}>
                    {t(`activities.${a.i18nKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2" data-testid="facet-difficulty">
            <Label htmlFor={difficultyId}>{t('filters.difficulty')}</Label>
            <Select
              value={parsed.difficulty ?? ''}
              onValueChange={(v) => navigate({ difficulty: v || null })}
            >
              <SelectTrigger id={difficultyId} className="w-full">
                <SelectValue placeholder={t('filters.allDifficulties')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('filters.allDifficulties')}</SelectItem>
                {DIFFICULTY_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {t(`filters.difficultyOptions.${d}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2" data-testid="facet-durationBand">
            <Label htmlFor={durationBandId}>{t('filters.duration')}</Label>
            <Select
              value={parsed.durationBand ?? ''}
              onValueChange={(v) => navigate({ durationBand: v || null })}
            >
              <SelectTrigger id={durationBandId} className="w-full">
                <SelectValue placeholder={t('filters.anyDuration')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('filters.anyDuration')}</SelectItem>
                {DURATION_BANDS.map((band) => (
                  <SelectItem key={band} value={band}>
                    {t(`filters.durationBands.${band}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2" data-testid="facet-season">
            <Label htmlFor={seasonId}>{t('filters.season')}</Label>
            <Select
              value={parsed.seasonMonth ? String(parsed.seasonMonth) : ''}
              onValueChange={(v) => navigate({ season: v || null })}
            >
              <SelectTrigger id={seasonId} className="w-full">
                <SelectValue placeholder={t('filters.anySeason')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('filters.anySeason')}</SelectItem>
                {MONTH_OPTIONS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t(`filters.months.${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2" data-testid="facet-groupSize">
            <Label htmlFor={groupSizeId}>{t('filters.groupSize')}</Label>
            <Input
              ref={groupRef}
              id={groupSizeId}
              type="number"
              inputMode="numeric"
              defaultValue={parsed.maxGroupSize ?? ''}
              min={1}
              placeholder={t('filters.groupSizePlaceholder')}
              aria-describedby={`${groupSizeId}-help`}
              className="tabular-nums"
              onChange={commitNumbersDebounced}
            />
            <p id={`${groupSizeId}-help`} className="text-2xs text-muted-foreground">
              {t('filters.groupSizeHelp')}
            </p>
          </div>
        </div>
      </details>

      {/* 5 — Price range (debounced) */}
      <fieldset className="space-y-2">
        <legend className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
          {t('filters.priceRange')}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2" data-testid="facet-minPrice">
            <Label htmlFor={minPriceId}>{t('filters.minPrice')}</Label>
            <Input
              ref={minPriceRef}
              id={minPriceId}
              type="number"
              inputMode="numeric"
              defaultValue={parsed.minPrice ?? ''}
              min={0}
              placeholder="0"
              className="tabular-nums"
              onChange={commitNumbersDebounced}
            />
          </div>
          <div className="space-y-2" data-testid="facet-maxPrice">
            <Label htmlFor={maxPriceId}>{t('filters.maxPrice')}</Label>
            <Input
              ref={maxPriceRef}
              id={maxPriceId}
              type="number"
              inputMode="numeric"
              defaultValue={parsed.maxPrice ?? ''}
              min={0}
              placeholder={t('filters.anyPrice')}
              className="tabular-nums"
              onChange={commitNumbersDebounced}
            />
          </div>
        </div>
      </fieldset>

      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => router.push(pathname, { scroll: false })}
      >
        {t('filters.clear')}
      </Button>
    </div>
  )
}
