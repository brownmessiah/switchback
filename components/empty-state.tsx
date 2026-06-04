import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Shared empty / dead-end state (critique C/customer-P2): a clean, icon-led
 * placeholder so sparse or shared/indexed pages (wishlist, a zero-listing
 * vendor storefront, …) aren't blank dashed boxes. A lucide icon + heading +
 * one-line description + an optional primary CTA. NO generated imagery.
 *
 * Server-component friendly (no client hooks). The icon is passed as a lucide
 * component; the CTA is a plain internal Link styled as the brand primary.
 */
export interface EmptyStateProps {
  /** Lucide icon component rendered in a tinted disc above the heading. */
  icon: LucideIcon
  /** Short heading — what's empty / what to do. */
  title: string
  /** One-line supporting description. */
  description?: string
  /** Optional primary CTA. */
  cta?: {
    href: string
    label: string
  }
  /** Optional extra content (secondary link, etc.) below the CTA. */
  children?: ReactNode
  className?: string
  /** Forwarded to the root for E2E selectors. */
  'data-testid'?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  children,
  className,
  'data-testid': dataTestid,
}: EmptyStateProps): ReactElement {
  return (
    <div
      data-testid={dataTestid}
      className={cn(
        'flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border px-6 py-16 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-7" />
      </span>
      <p className="text-lg font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {cta ? (
        <Link
          href={cta.href}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {cta.label}
        </Link>
      ) : null}
      {children}
    </div>
  )
}
