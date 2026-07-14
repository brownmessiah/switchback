'use client'

import Link from 'next/link'
import type { ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ShoppingCart } from 'lucide-react'

import { getCartCountAction } from '@/app/(app)/cart/actions'

/** Window event carrying the fresh count after a cart mutation. */
export const CART_COUNT_EVENT = 'outvers:cart-count'

/** Fire-and-forget count broadcast for mutation call sites. */
export function broadcastCartCount(count: number): void {
  window.dispatchEvent(new CustomEvent<number>(CART_COUNT_EVENT, { detail: count }))
}

/**
 * Header cart icon + live item-count badge (home-redesign issue 11 —
 * finishes the slot deferred from issue 06). Fetches its count once on
 * mount via a server action (NotificationBell pattern — no polling, no
 * shared store) AND listens for CART_COUNT_EVENT: the header lives in the
 * persistent layout, so client-side navigations never remount it — without
 * the event the badge would show a stale count right after the add/remove
 * it exists to reflect (review finding). Mutation call sites broadcast the
 * count their action already returns. Mounted inside AuthStatus (signed-in
 * only; /cart itself is auth-gated anyway).
 */
export function CartIndicator(): ReactElement {
  const t = useTranslations('Nav')
  const [count, setCount] = useState(0)

  useEffect(() => {
    getCartCountAction()
      .then(setCount)
      .catch(() => {
        // Badge is a convenience — a failed count never breaks the header.
      })
    const onCount = (e: Event): void => {
      setCount((e as CustomEvent<number>).detail)
    }
    window.addEventListener(CART_COUNT_EVENT, onCount)
    return () => window.removeEventListener(CART_COUNT_EVENT, onCount)
  }, [])

  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `${t('cart')} (${count})` : t('cart')}
      data-testid="cart-indicator"
      className="relative inline-flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ShoppingCart aria-hidden="true" className="size-4" />
      {count > 0 && (
        <span
          data-testid="cart-indicator-count"
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-2xs font-semibold tabular-nums text-primary-foreground"
        >
          {count}
        </span>
      )}
    </Link>
  )
}
