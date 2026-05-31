'use client'

import { Heart } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { toggleWishlistAction } from '@/app/(app)/wishlist/actions'
import { cn } from '@/lib/utils'

interface WishlistButtonProps {
  experienceId: string
  /** Saved state resolved on the server for the current Customer. */
  initialSaved: boolean
  /** Optional extra classes for placement (e.g. card overlay). */
  className?: string
}

/**
 * Heart toggle bound to `toggleWishlistAction` (Issue #08). Optimistic: it
 * flips the local saved state immediately, then reconciles with the server
 * result. An `unauthenticated` result routes the Customer to /sign-in (the
 * button still renders for logged-out users, with initialSaved=false, so the
 * click is the sign-in nudge).
 */
export function WishlistButton({
  experienceId,
  initialSaved,
  className,
}: WishlistButtonProps) {
  const router = useRouter()
  const t = useTranslations('WishlistPage')
  const [saved, setSaved] = useState(initialSaved)
  const [isPending, startTransition] = useTransition()

  function handleToggle() {
    // Optimistic flip — reconciled with the authoritative server result.
    const optimistic = !saved
    setSaved(optimistic)

    startTransition(async () => {
      const result = await toggleWishlistAction(experienceId)
      if (!result.ok) {
        // Roll back the optimistic flip and route to sign-in.
        setSaved(!optimistic)
        router.push('/sign-in')
        return
      }
      setSaved(result.saved)
    })
  }

  const label = saved ? t('button.saved') : t('button.save')

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={isPending}
      aria-pressed={saved}
      aria-label={saved ? t('button.ariaRemove') : t('button.ariaAdd')}
      data-testid="wishlist-button"
      data-saved={saved ? 'true' : 'false'}
      data-pending={isPending ? 'true' : 'false'}
      className={cn(
        'inline-flex items-center gap-2 rounded-[var(--radius-pill)] border bg-card px-3 py-1.5 text-sm font-medium shadow-[var(--shadow-sm)] transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60',
        saved ? 'border-primary/40 text-primary-strong' : 'border-border text-foreground',
        className,
      )}
    >
      <Heart
        aria-hidden="true"
        className={cn('size-4', saved && 'fill-current')}
      />
      {label}
    </button>
  )
}
