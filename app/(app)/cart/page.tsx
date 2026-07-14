import type { ReactElement } from 'react'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { getCart } from '@/lib/cart/core'

import { CartView } from './cart-view'

/**
 * /cart — the Customer's saved list (home-redesign issue 11, ADR-0021).
 *
 * Auth-gated server component in the un-localized app/(app) group (in
 * EXCLUDED_PREFIXES — the locale middleware must not rewrite it), mirroring
 * checkout/page.tsx: resolve the session, load server-side, render a client
 * island. Checkout itself is issue 12 — the CTA here is deliberately inert.
 */

export const metadata = {
  title: 'Your cart — Outvers',
  robots: { index: false },
}

export default async function CartPage(): Promise<ReactElement> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const cart = await getCart(db, session.user.id)

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-heading text-h2 font-bold tracking-tight">Your cart</h1>
      <CartView initialCart={cart} />
    </main>
  )
}
