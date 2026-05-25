import Link from 'next/link'
import type { ReactElement } from 'react'

/**
 * Top-of-page navigation present on every public route. Server Component;
 * the sign-in CTA is just a link for v1 — actual auth UI hangs off the
 * /sign-in route added in a later phase.
 *
 * `lng` defaults to 'en' so callers from the root `/` route (which has no
 * locale segment) render valid hrefs. Locale-aware pages override.
 */
interface SiteHeaderProps {
  lng?: string
}

export function SiteHeader({ lng = 'en' }: SiteHeaderProps): ReactElement {
  const prefix = lng === 'en' ? '' : `/${lng}`

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-black/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href={`${prefix}/`}
          className="text-lg font-semibold tracking-tight text-zinc-900 hover:text-zinc-700 dark:text-zinc-50 dark:hover:text-zinc-300"
          aria-label="Outvers home"
        >
          Outvers
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-6 sm:flex">
          <Link
            href={`${prefix}/search`}
            className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Search
          </Link>
          <Link
            href={`${prefix}/adventure/rafting-in-rishikesh`}
            className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Adventures
          </Link>
          <Link
            href={`${prefix}/cancellation-policy`}
            className="text-sm text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Refund policy
          </Link>
          <Link
            href={`${prefix}/sign-in`}
            className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-black dark:hover:bg-zinc-300"
          >
            Sign in
          </Link>
        </nav>

        <details className="sm:hidden">
          <summary
            className="cursor-pointer list-none rounded-md p-2 text-zinc-700 dark:text-zinc-300"
            aria-label="Open menu"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </summary>
          <nav
            aria-label="Mobile primary"
            className="absolute right-4 mt-2 flex w-48 flex-col gap-1 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
          >
            <Link
              href={`${prefix}/search`}
              className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Search
            </Link>
            <Link
              href={`${prefix}/adventure/rafting-in-rishikesh`}
              className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Adventures
            </Link>
            <Link
              href={`${prefix}/cancellation-policy`}
              className="rounded px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Refund policy
            </Link>
            <Link
              href={`${prefix}/sign-in`}
              className="rounded px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 dark:text-zinc-50 dark:hover:bg-zinc-800"
            >
              Sign in
            </Link>
          </nav>
        </details>
      </div>
    </header>
  )
}
