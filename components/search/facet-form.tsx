import type { ReactElement } from 'react'

import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Button, buttonVariants } from '@/components/ui/button'
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

/** ADR-0017 difficulty enum values — facet options + i18n key suffixes. */
const DIFFICULTY_OPTIONS = ['easy', 'moderate', 'challenging', 'extreme'] as const
/** Months 1-12 for the "runs in month" facet. */
const MONTH_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const

interface FacetFormProps {
  locale: string
  parsed: SearchExperiencesParams
  /**
   * Disambiguates the two instances of the form on a page (the SSR desktop
   * rail and the mobile Sheet) so their control `id`s/testids stay unique and
   * `<Label htmlFor>` bindings remain valid for axe.
   */
  instanceId: string
}

/**
 * The faceted search filter form (DESIGN.md §4 / A1 "filter rail (desktop) /
 * filter Sheet (mobile)"). A native `<form method="get" action="/search">` so
 * filtering works without client JS and the searchParam-name contract
 * (`activity`, `region`, `sort`, `minPrice`, `maxPrice`) — which the page
 * parses and the ADR-0013 robots/canonical rules depend on — is preserved.
 *
 * Backend-supported facets only (the Meili index's filterable attributes):
 * Activity, Region, Sort, and Price range. The KYC-tier facet is deliberately
 * omitted — the index carries no `vendorKycTier` (see defects-log).
 *
 * Rendered as a Server Component so it works inside the SSR rail AND when
 * streamed as `children` into the client filter Sheet.
 */
export async function FacetForm({
  locale,
  parsed,
  instanceId,
}: FacetFormProps): Promise<ReactElement> {
  const t = await getTranslations({ locale, namespace: 'SearchPage' })

  const categoryId = `${instanceId}-category`
  const activityId = `${instanceId}-activity`
  const stateId = `${instanceId}-state`
  const regionId = `${instanceId}-region`
  const sortId = `${instanceId}-sort`
  const minPriceId = `${instanceId}-minPrice`
  const maxPriceId = `${instanceId}-maxPrice`
  const difficultyId = `${instanceId}-difficulty`
  const durationBandId = `${instanceId}-durationBand`
  const seasonId = `${instanceId}-season`
  const groupSizeId = `${instanceId}-groupSize`

  return (
    <form method="get" action="/search" className="space-y-5">
      {parsed.q && <input type="hidden" name="q" value={parsed.q} />}

      <div className="space-y-2" data-testid="facet-category">
        <Label htmlFor={categoryId}>{t('filters.category')}</Label>
        <Select name="category" defaultValue={parsed.category ?? ''}>
          <SelectTrigger id={categoryId} className="w-full">
            <SelectValue placeholder={t('filters.allCategories')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t('filters.allCategories')}</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.slug} value={c.slug}>
                {t(`filters.categoryOptions.${c.i18nKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2" data-testid="facet-activity">
        <Label htmlFor={activityId}>{t('filters.activity')}</Label>
        <Select name="activity" defaultValue={parsed.activity ?? ''}>
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

      <fieldset className="space-y-3">
        <legend className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
          {t('filters.destination')}
        </legend>
        <div className="space-y-2" data-testid="facet-state">
          <Label htmlFor={stateId}>{t('filters.state')}</Label>
          <Select name="state" defaultValue={parsed.state ?? ''}>
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
          <Select name="region" defaultValue={parsed.region ?? ''}>
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

      <div className="space-y-2" data-testid="facet-difficulty">
        <Label htmlFor={difficultyId}>{t('filters.difficulty')}</Label>
        <Select name="difficulty" defaultValue={parsed.difficulty ?? ''}>
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
        <Select name="durationBand" defaultValue={parsed.durationBand ?? ''}>
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
          name="season"
          defaultValue={parsed.seasonMonth ? String(parsed.seasonMonth) : ''}
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
          id={groupSizeId}
          type="number"
          inputMode="numeric"
          name="groupSize"
          defaultValue={parsed.maxGroupSize ?? ''}
          min={1}
          placeholder={t('filters.groupSizePlaceholder')}
          aria-describedby={`${groupSizeId}-help`}
          className="tabular-nums"
        />
        <p id={`${groupSizeId}-help`} className="text-2xs text-muted-foreground">
          {t('filters.groupSizeHelp')}
        </p>
      </div>

      <div className="space-y-2" data-testid="facet-sort">
        <Label htmlFor={sortId}>{t('filters.sortBy')}</Label>
        <Select name="sort" defaultValue={parsed.sort ?? 'relevance'}>
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

      <fieldset className="space-y-2">
        <legend className="text-2xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
          {t('filters.priceRange')}
        </legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2" data-testid="facet-minPrice">
            <Label htmlFor={minPriceId}>{t('filters.minPrice')}</Label>
            <Input
              id={minPriceId}
              type="number"
              inputMode="numeric"
              name="minPrice"
              defaultValue={parsed.minPrice ?? ''}
              min={0}
              placeholder="0"
              className="tabular-nums"
            />
          </div>
          <div className="space-y-2" data-testid="facet-maxPrice">
            <Label htmlFor={maxPriceId}>{t('filters.maxPrice')}</Label>
            <Input
              id={maxPriceId}
              type="number"
              inputMode="numeric"
              name="maxPrice"
              defaultValue={parsed.maxPrice ?? ''}
              min={0}
              placeholder={t('filters.anyPrice')}
              className="tabular-nums"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-col gap-2">
        <Button type="submit" className="w-full">
          {t('filters.applyFilters')}
        </Button>
        <Link
          href="/search"
          className={buttonVariants({ variant: 'ghost', className: 'w-full' })}
        >
          {t('filters.clear')}
        </Link>
      </div>
    </form>
  )
}
