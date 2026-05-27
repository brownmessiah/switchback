import Link from 'next/link'
import type { ReactElement } from 'react'

/**
 * Bottom-of-page footer present on every public route. v2 with
 * 4-column link grid (Explore, Company, Support, For Vendors).
 * Cancellation policy is the load-bearing link (ADR-0005 --
 * "link to it from every Experience card") so it appears in
 * both header and footer.
 */

export function SiteFooter(): ReactElement {
  return (
    <footer className="mt-16 border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:gap-12">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-1">
            <Link
              href="/"
              className="text-lg font-semibold tracking-tight"
              aria-label="Outvers home"
            >
              Outvers
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Adventure activities across India from KYC-verified vendors.
              Transparent refund policy, real-time slot availability.
            </p>
          </div>

          {/* Explore */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Explore
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/search" className="text-foreground/80 transition hover:text-primary">
                  Search
                </Link>
              </li>
              <li>
                <Link href="/adventure/rafting-in-rishikesh" className="text-foreground/80 transition hover:text-primary">
                  Adventures
                </Link>
              </li>
              <li>
                <Link href="/search?activity=paragliding" className="text-foreground/80 transition hover:text-primary">
                  Paragliding
                </Link>
              </li>
              <li>
                <Link href="/search?activity=scuba" className="text-foreground/80 transition hover:text-primary">
                  Scuba diving
                </Link>
              </li>
            </ul>
          </div>

          {/* Support */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Support
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/cancellation-policy" className="text-foreground/80 transition hover:text-primary">
                  Refund policy
                </Link>
              </li>
              <li>
                <span className="text-muted-foreground">Help centre (soon)</span>
              </li>
              <li>
                <span className="text-muted-foreground">Contact us (soon)</span>
              </li>
            </ul>
          </div>

          {/* For Vendors */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              For Vendors
            </h3>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/vendor/onboarding" className="text-foreground/80 transition hover:text-primary">
                  List your experience
                </Link>
              </li>
              <li>
                <Link href="/vendor/dashboard" className="text-foreground/80 transition hover:text-primary">
                  Vendor dashboard
                </Link>
              </li>
              <li>
                <span className="text-muted-foreground">Vendor KYC (soon)</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-muted-foreground sm:px-6">
          &copy; {new Date().getFullYear()} Outvers. All experiences are operated by
          third-party vendors.
        </p>
      </div>
    </footer>
  )
}
