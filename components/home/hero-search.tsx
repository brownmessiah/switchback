import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactElement } from 'react'

/**
 * Headout-style single hero search (owner screenshots, 2026-06-11).
 *
 * ONE field — "Destination or activity" — replacing the 4-field structured
 * module (issue 09): a plain GET form to /search carrying the existing `q`
 * full-text param, so it is crawlable and works with zero JS. Meilisearch
 * matches destination, activity, Experience and Vendor names through the same
 * `q` pipeline the /search page already uses; date + group size stay on the
 * /search facet rail rather than crowding the hero.
 */
export function HomeHeroSearch(): ReactElement {
  const t = useTranslations('HomeSearch')

  return (
    <form
      action="/search"
      method="get"
      role="search"
      data-testid="home-hero-search"
      className="mt-7 w-full max-w-xl"
    >
      <div className="flex items-center gap-2 rounded-[var(--radius-pill)] bg-surface-0/95 p-2 shadow-[var(--shadow-lg)] ring-1 ring-foreground/10 backdrop-blur-sm">
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
