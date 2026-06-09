'use client'

import { useState, type FormEvent, type ReactElement } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CalendarDays, MapPin, Mountain, Search, Users } from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { buildHomeSearchQuery } from '@/lib/search/home-query'
import { cn } from '@/lib/utils'

/** One Destination / Activity option, derived from the controlled registries. */
export interface StructuredSearchOption {
  /** Registry slug submitted as the facet value (e.g. `region=rishikesh`). */
  readonly slug: string
  /** i18n key suffix under `SearchPage.regions` / `SearchPage.activities`. */
  readonly i18nKey: string
  /** English display name — fallback label used as the `<option>` text. */
  readonly nameEn: string
}

interface HomeStructuredSearchProps {
  /** Inventory-backed Destination options (regions with published inventory). */
  readonly destinations: readonly StructuredSearchOption[]
  /** Inventory-backed Activity options (activities with published inventory). */
  readonly activities: readonly StructuredSearchOption[]
}

interface FieldsState {
  destination: string
  activity: string
  date: string
  groupSize: string
}

const EMPTY: FieldsState = { destination: '', activity: '', date: '', groupSize: '' }

/**
 * Home hero structured search (issue 09). Replaces the single keyword field
 * with four Customer-language fields — Destination, Activity, Date, Group size —
 * and maps them onto the EXISTING `/search` facets via `lib/search/home-query`
 * (NO new query infra). The Date field selects WHEN (its month → the `season`
 * facet), not a specific Availability slot.
 *
 * Layout (ADR-0018 tiers):
 *   - sm+ : an inline 4-field bar, lifted off the hero photo.
 *   - < sm: a single full-width trigger that opens a full-screen overlay
 *           (bottom Sheet, `h-[100dvh]`) with large ≥44px touch targets, so the
 *           hero stays usable one-handed on a phone.
 *
 * Options are passed in (already gated to inventory-backed regions/activities)
 * so this stays a presentation-only client island; the page resolves the
 * registries + counts server-side.
 */
export function HomeStructuredSearch({
  destinations,
  activities,
}: HomeStructuredSearchProps): ReactElement {
  const t = useTranslations('HomeSearch')
  const router = useRouter()
  const [fields, setFields] = useState<FieldsState>(EMPTY)
  const [open, setOpen] = useState(false)

  function update(patch: Partial<FieldsState>): void {
    setFields((prev) => ({ ...prev, ...patch }))
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const groupSize = Number.parseInt(fields.groupSize, 10)
    const href = buildHomeSearchQuery({
      destination: fields.destination,
      activity: fields.activity,
      date: fields.date,
      groupSize: Number.isNaN(groupSize) ? undefined : groupSize,
    })
    setOpen(false)
    router.push(href)
  }

  const labels = {
    destination: t('fields.destination'),
    activity: t('fields.activity'),
    date: t('fields.date'),
    groupSize: t('fields.groupSize'),
  }
  const placeholders = {
    destination: t('placeholders.destination'),
    activity: t('placeholders.activity'),
    groupSize: t('placeholders.groupSize'),
  }

  // The four fields, rendered identically in the desktop bar and the mobile
  // overlay (idPrefix keeps the control ids unique across the two instances so
  // <label htmlFor> bindings stay axe-clean). `large` bumps the controls to the
  // ADR-0018 ≥44px touch floor inside the overlay.
  function renderFields(idPrefix: string, large: boolean): ReactElement {
    const controlBase = cn(
      'min-tap w-full rounded-[var(--radius-control)] border border-input bg-surface-1 text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      large ? 'h-12 px-4 text-base' : 'h-11 px-3 text-sm',
    )
    return (
      <>
        <div className={large ? 'space-y-1.5' : 'flex-1'}>
          <label
            htmlFor={`${idPrefix}-destination`}
            className={large ? 'block text-sm font-medium' : 'sr-only'}
          >
            {labels.destination}
          </label>
          <div className="relative">
            <MapPin
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <select
              id={`${idPrefix}-destination`}
              data-testid="home-search-destination"
              value={fields.destination}
              onChange={(e) => update({ destination: e.target.value })}
              className={cn(controlBase, 'appearance-none pl-9')}
              aria-label={labels.destination}
            >
              <option value="">{placeholders.destination}</option>
              {destinations.map((d) => (
                <option key={d.slug} value={d.slug}>
                  {d.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={large ? 'space-y-1.5' : 'flex-1'}>
          <label
            htmlFor={`${idPrefix}-activity`}
            className={large ? 'block text-sm font-medium' : 'sr-only'}
          >
            {labels.activity}
          </label>
          <div className="relative">
            <Mountain
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <select
              id={`${idPrefix}-activity`}
              data-testid="home-search-activity"
              value={fields.activity}
              onChange={(e) => update({ activity: e.target.value })}
              className={cn(controlBase, 'appearance-none pl-9')}
              aria-label={labels.activity}
            >
              <option value="">{placeholders.activity}</option>
              {activities.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.nameEn}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={large ? 'space-y-1.5' : 'flex-1'}>
          <label
            htmlFor={`${idPrefix}-date`}
            className={large ? 'block text-sm font-medium' : 'sr-only'}
          >
            {labels.date}
          </label>
          <div className="relative">
            <CalendarDays
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={`${idPrefix}-date`}
              data-testid="home-search-date"
              type="date"
              value={fields.date}
              onChange={(e) => update({ date: e.target.value })}
              className={cn(controlBase, 'pl-9')}
              aria-label={labels.date}
            />
          </div>
        </div>

        <div className={large ? 'space-y-1.5' : 'flex-1'}>
          <label
            htmlFor={`${idPrefix}-groupSize`}
            className={large ? 'block text-sm font-medium' : 'sr-only'}
          >
            {labels.groupSize}
          </label>
          <div className="relative">
            <Users
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <input
              id={`${idPrefix}-groupSize`}
              data-testid="home-search-groupSize"
              type="number"
              inputMode="numeric"
              min={1}
              value={fields.groupSize}
              onChange={(e) => update({ groupSize: e.target.value })}
              placeholder={placeholders.groupSize}
              className={cn(controlBase, 'pl-9 tabular-nums')}
              aria-label={labels.groupSize}
            />
          </div>
        </div>
      </>
    )
  }

  return (
    <div className="mt-8 w-full max-w-3xl">
      {/* Desktop / tablet — inline 4-field bar (sm+). */}
      <form
        action="/search"
        method="get"
        data-testid="home-search-form"
        onSubmit={submit}
        className="hidden flex-col gap-2 rounded-[var(--radius-card)] bg-surface-0 p-2 shadow-[var(--shadow-lg)] ring-1 ring-foreground/10 sm:flex sm:flex-row sm:items-end"
      >
        {renderFields('home-desktop', false)}
        <button
          type="submit"
          className="min-tap inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Search className="size-4" aria-hidden="true" />
          {t('submit')}
        </button>
      </form>

      {/* Mobile — full-screen overlay (< sm). The trigger looks like a search
          field; tapping it opens the bottom Sheet sized to the viewport. */}
      <div className="sm:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            data-testid="home-search-mobile-trigger"
            className="min-tap flex h-12 w-full items-center gap-2 rounded-[var(--radius-control)] bg-surface-0 px-4 text-left text-sm font-medium text-muted-foreground shadow-[var(--shadow-lg)] ring-1 ring-foreground/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t('mobileTrigger')}
          </SheetTrigger>
          <SheetContent
            side="bottom"
            data-testid="home-search-overlay"
            className="flex h-[100dvh] flex-col overflow-y-auto rounded-none p-6"
            aria-label={t('overlayTitle')}
          >
            <SheetHeader className="px-0 pt-0">
              <SheetTitle>{t('overlayTitle')}</SheetTitle>
            </SheetHeader>
            <form
              action="/search"
              method="get"
              data-testid="home-search-form-mobile"
              onSubmit={submit}
              className="flex flex-1 flex-col gap-4"
            >
              {renderFields('home-mobile', true)}
              <button
                type="submit"
                className="min-tap mt-2 inline-flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Search className="size-5" aria-hidden="true" />
                {t('submit')}
              </button>
            </form>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  )
}
