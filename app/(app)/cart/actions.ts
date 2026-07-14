'use server'

import { headers } from 'next/headers'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import {
  addToCart,
  CartError,
  getCartCount,
  removeFromCart,
  updateCartItem,
} from '@/lib/cart/core'

/**
 * Thin `'use server'` wrappers over the db-injected cart core (issue 11,
 * ADR-0021). House rules: a 'use server' module may export ONLY async
 * functions (types/results live in lib/cart/core); every wrapper re-derives
 * the customer from the SESSION — the client never supplies a user id.
 */

interface CartActionFailure {
  ok: false
  error: string
  message: string
}

function mapCartError(err: unknown): CartActionFailure {
  if (err instanceof CartError) {
    const message =
      err.code === 'SLOT_NOT_BOOKABLE'
        ? 'That time slot is no longer bookable.'
        : err.code === 'ITEM_NOT_FOUND'
          ? 'That cart item no longer exists.'
          : 'That selection is no longer available.'
    return { ok: false, error: err.code, message }
  }
  return { ok: false, error: 'unknown', message: 'Something went wrong. Please try again.' }
}

export async function addToCartAction(input: {
  experienceId: string
  slotId: string
  variationId?: string
  participantCount: number
}): Promise<
  { ok: true; cartItemId: string; cartCount: number } | CartActionFailure
> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'unauthenticated', message: 'Sign in to add to your cart.' }
  }
  try {
    const item = await addToCart(db, {
      customerUserId: session.user.id,
      experienceId: input.experienceId,
      slotId: input.slotId,
      variationId: input.variationId,
      participantCount: input.participantCount,
    })
    const cartCount = await getCartCount(db, session.user.id)
    return { ok: true, cartItemId: item.id, cartCount }
  } catch (err) {
    return mapCartError(err)
  }
}

export async function updateCartItemAction(input: {
  cartItemId: string
  participantCount: number
}): Promise<{ ok: true } | CartActionFailure> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'unauthenticated', message: 'Sign in to edit your cart.' }
  }
  try {
    await updateCartItem(db, {
      customerUserId: session.user.id,
      cartItemId: input.cartItemId,
      participantCount: input.participantCount,
    })
    return { ok: true }
  } catch (err) {
    return mapCartError(err)
  }
}

export async function removeFromCartAction(input: {
  cartItemId: string
}): Promise<{ ok: true; cartCount: number } | CartActionFailure> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'unauthenticated', message: 'Sign in to edit your cart.' }
  }
  try {
    await removeFromCart(db, {
      customerUserId: session.user.id,
      cartItemId: input.cartItemId,
    })
    const cartCount = await getCartCount(db, session.user.id)
    return { ok: true, cartCount }
  } catch (err) {
    return mapCartError(err)
  }
}

/** Header badge count. Anonymous sessions read as an empty cart. */
export async function getCartCountAction(): Promise<number> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return 0
  return getCartCount(db, session.user.id)
}
