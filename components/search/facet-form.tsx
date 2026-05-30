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
import { ACTIVITY_OPTIONS, REGION_OPTIONS } from '@/lib/search/facet-options'
import type { SearchExperiencesParams } from '@/lib/search/search-experiences'

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

  const activityId = `${instanceId}-activity`
  const regionId = `${instanceId}-region`
  const sortId = `${instanceId}-sort`
  const minPriceId = `${instanceId}-minPrice`
  const maxPriceId = `${instanceId}-maxPrice`

  return (
    <form method="get" action="/search" className="space-y-5">
      {parsed.q && <input type="hidden" name="q" value={parsed.q} />}

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
