'use client'

import { Search, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactElement } from 'react'
import { useState } from 'react'

import { DatePopover } from '@/components/search/date-popover'
import { ParticipantsStepper } from '@/components/search/participants-stepper'

/**
 * Unified hero search bar (home-redesign issue 07 / CR5+CR7):
 * `[Search places or activities] [participants] [Search]` in one pill.
 *
 * Still a plain GET form to /search — the `q` field submits with ZERO JS
 * (progressive enhancement; the WebSite JSON-LD SearchAction /search?q=
 * stays truthful and the hero stays crawlable). The participants stepper is
 * a client enhancement wired to the EXISTING `groupSize` param
 * (parseSearchParams → maxGroupSize "fits a group of N"): at the default of
 * 1 no `groupSize` input is emitted at all, so the canonical /search?q= URL
 * shape (ADR-0013) and the no-JS submit are byte-identical to the old
 * single-field bar.
 *
 * The date segment is deliberately ABSENT — it arrives in issue 10 together
 * with the ADR-0020 availability backend (no dead controls).
 */

/** Hero-side ceiling; the /search facet rail stays free-form (min 1). */
const MAX_PARTICIPANTS = 20

export function HomeHeroSearch(): ReactElement {
  const t = useTranslations('HomeSearch')
  const [participants, setParticipants] = useState(1)
  const [date, setDate] = useState<string | null>(null)

  return (
    <form
      action="/search"
      method="get"
      role="search"
      data-testid="home-hero-search"
      className="mt-7 w-full max-w-2xl"
    >
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] bg-surface-0/95 p-2 shadow-[var(--shadow-lg)] ring-1 ring-foreground/10 backdrop-blur-sm sm:flex-row sm:items-center sm:rounded-[var(--radius-pill)]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Search
            aria-hidden="true"
            className="ml-3 size-5 shrink-0 text-muted-foreground"
          />
          <input
            type="search"
            name="q"
            aria-label={t('single.label')}
            placeholder={t('single.placeholder')}
            autoComplete="off"
            className="min-tap h-11 w-full bg-transparent text-base text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {/* Date segment (issue 10 / CR6): popover with quick pills + a
            2-month grid (ADR-0020). The hidden input exists only when a day
            is picked, so the default submit stays /search?q=. */}
        <div className="flex items-center border-t border-border/60 px-2 pt-2 sm:border-l sm:border-t-0 sm:pt-0">
          <DatePopover value={date} onChange={setDate} />
          {date !== null && <input type="hidden" name="date" value={date} />}
        </div>

        {/* Participants segment (CR7): the shared stepper displays the
            translated ICU count ("2 people") as its live value. The hidden
            input only exists above the default so a plain submit stays
            /search?q=. */}
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-3 pt-2 sm:border-l sm:border-t-0 sm:pt-0">
          <Users
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <ParticipantsStepper
            label={t('fields.groupSize')}
            value={participants}
            min={1}
            max={MAX_PARTICIPANTS}
            onChange={setParticipants}
            valueText={t('participants.count', { count: participants })}
          />
          {participants > 1 && (
            <input type="hidden" name="groupSize" value={participants} />
          )}
        </div>

        <button
          type="submit"
          className="min-tap inline-flex h-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {t('single.submit')}
        </button>
      </div>
    </form>
  )
}
