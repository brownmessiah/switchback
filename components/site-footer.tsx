import Link from 'next/link'
import type { ReactElement } from 'react'

/**
 * Bottom-of-page footer present on every public route. v1 keeps the
 * footer link set minimal — anything that doesn't have a real
 * destination doesn't get a link. Cancellation policy is the
 * load-bearing link (ADR-0005 — "link to it from every Experience card")
 * so it appears in both header and footer.
 */

export function SiteFooter(): ReactElement {
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-white py-10 dark:border-zinc-800 dark:bg-black">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
          >
            Outvers
          </Link>
          <p className="mt-2 max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
            Adventure activities across India from KYC-verified vendors. Transparent
            refund policy, real-time slot availability.
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
          <span className="col-span-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            Explore
          </span>
          <Link
            href="/search"
            className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Search
          </Link>
          <Link
            href="/adventure/rafting-in-rishikesh"
            className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Adventures
          </Link>

          <span className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            Trust
          </span>
          <Link
            href="/cancellation-policy"
            className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-50"
          >
            Refund policy
          </Link>
          <span className="text-zinc-400 dark:text-zinc-600">Vendor KYC (soon)</span>
        </nav>
      </div>
      <p className="mx-auto mt-8 max-w-6xl px-4 text-xs text-zinc-500 sm:px-6">
        © {new Date().getFullYear()} Outvers. All experiences are operated by
        third-party vendors.
      </p>
    </footer>
  )
}
