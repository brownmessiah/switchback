import { and, count, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { cartItems, carts, type CartItem } from '@/db/schema/carts'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { bracketKeyFor } from '@/lib/experiences/booking-price'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Customer-cart core (home-redesign issue 11, ADR-0021).
 *
 * Plain, DBOrTx-injected module — the `'use server'` wrappers in
 * app/(app)/cart/actions.ts stay thin (a 'use server' file may export ONLY
 * async functions; types and cores live here). Every mutation is
 * ownership-scoped by `customerUserId` — a cart item id alone can never
 * touch another customer's cart (IDOR guard at the SQL level).
 *
 * Money: the stored `price_per_participant_snapshot` is a DISPLAY snapshot
 * (M2 snapshot rule) — group-size bracket price, or the chosen variation's
 * flat per-person price. It is re-taken on merge/update and NEVER charged
 * from; checkout (issue 12) resolves authoritative prices via
 * createBooking. Rupee math is integer-only (`Math.floor`, the PDP loader convention), storage is
 * numeric(12,2) strings.
 */

export type CartErrorCode =
  | 'SLOT_NOT_FOUND'
  | 'SLOT_MISMATCH'
  | 'SLOT_NOT_BOOKABLE'
  | 'VARIATION_MISMATCH'
  | 'ITEM_NOT_FOUND'
  | 'CART_FULL'

/**
 * Line-count ceiling. Keeps /cart rendering bounded AND pre-bounds the
 * issue-12 checkout transaction (N sequential createBooking savepoints under
 * one outer tx — security review asked for a small N).
 */
export const MAX_CART_LINES = 25

export class CartError extends Error {
  readonly code: CartErrorCode

  constructor(code: CartErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'CartError'
    this.code = code
  }
}

const AddToCartSchema = z.object({
  customerUserId: z.string().min(1),
  experienceId: z.string().uuid(),
  slotId: z.string().uuid(),
  variationId: z.string().uuid().optional(),
  participantCount: z.number().int().min(1).max(50),
})
export type AddToCartInput = z.infer<typeof AddToCartSchema>

const UpdateCartItemSchema = z.object({
  customerUserId: z.string().min(1),
  cartItemId: z.string().uuid(),
  participantCount: z.number().int().min(1).max(50),
})
export type UpdateCartItemInput = z.infer<typeof UpdateCartItemSchema>

export interface CartLine {
  readonly id: string
  readonly experienceId: string
  readonly experienceSlug: string
  readonly experienceTitle: string
  readonly slotId: string
  readonly slotStartAtISO: string
  readonly variationId: string | null
  readonly variationName: string | null
  readonly participantCount: number
  readonly pricePerParticipantRupees: number
  readonly lineTotalRupees: number
}

export interface CartView {
  readonly items: CartLine[]
  readonly subtotalRupees: number
}

/**
 * Resolve the DISPLAY per-participant price: the variation's flat price when
 * one is chosen, else the experience's group-size bracket price.
 */
function displayPrice(
  exp: {
    pricePerPerson_1_2: string
    pricePerPerson_3_5: string
    pricePerPerson_6_plus: string
  },
  variationPrice: string | null,
  participantCount: number,
): string {
  if (variationPrice !== null) return Number(variationPrice).toFixed(2)
  const bracket = bracketKeyFor(participantCount)
  const perPerson =
    bracket === '1_2'
      ? exp.pricePerPerson_1_2
      : bracket === '3_5'
        ? exp.pricePerPerson_3_5
        : exp.pricePerPerson_6_plus
  return Number(perPerson).toFixed(2)
}

export async function addToCart(db: DBOrTx, rawInput: AddToCartInput): Promise<CartItem> {
  const input = AddToCartSchema.parse(rawInput)

  const [slot] = await db
    .select({
      id: availabilitySlots.id,
      experienceId: availabilitySlots.experienceId,
      status: availabilitySlots.status,
      startAt: availabilitySlots.startAt,
    })
    .from(availabilitySlots)
    .where(eq(availabilitySlots.id, input.slotId))
    .limit(1)
  if (!slot) throw new CartError('SLOT_NOT_FOUND')
  if (slot.experienceId !== input.experienceId) throw new CartError('SLOT_MISMATCH')
  if (slot.status !== 'open' || slot.startAt.getTime() <= Date.now()) {
    throw new CartError('SLOT_NOT_BOOKABLE')
  }

  const [exp] = await db
    .select({
      status: experiences.status,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
    })
    .from(experiences)
    .where(eq(experiences.id, input.experienceId))
    .limit(1)
  if (!exp) throw new CartError('SLOT_MISMATCH')
  // Wishlist-precedent gate: only live listings are cartable (a PDP left
  // open across an unpublish would otherwise add draft/paused inventory).
  if (exp.status !== 'published') throw new CartError('SLOT_NOT_BOOKABLE')

  let variationPrice: string | null = null
  if (input.variationId) {
    const [variation] = await db
      .select({
        experienceId: experiencePricingVariations.experienceId,
        pricePerPerson: experiencePricingVariations.pricePerPerson,
      })
      .from(experiencePricingVariations)
      .where(eq(experiencePricingVariations.id, input.variationId))
      .limit(1)
    if (!variation || variation.experienceId !== input.experienceId) {
      throw new CartError('VARIATION_MISMATCH')
    }
    variationPrice = variation.pricePerPerson
  }

  const snapshot = displayPrice(exp, variationPrice, input.participantCount)

  // Lazily create the customer's single cart (unique customer_user_id).
  const [cart] = await db
    .insert(carts)
    .values({ customerUserId: input.customerUserId })
    .onConflictDoUpdate({
      target: carts.customerUserId,
      set: { updatedAt: sql`now()` },
    })
    .returning({ id: carts.id })

  // Line-count cap — MERGES into an existing line stay allowed at the cap;
  // only NET-NEW lines are refused.
  const [existingLine] = await db
    .select({ id: cartItems.id })
    .from(cartItems)
    .where(and(eq(cartItems.cartId, cart!.id), eq(cartItems.slotId, input.slotId)))
    .limit(1)
  if (!existingLine) {
    const [{ n }] = (await db
      .select({ n: count() })
      .from(cartItems)
      .where(eq(cartItems.cartId, cart!.id))) as [{ n: number }]
    if (n >= MAX_CART_LINES) throw new CartError('CART_FULL')
  }

  // One line per (cart, slot): re-adding MERGES (count/variation/price).
  const [item] = await db
    .insert(cartItems)
    .values({
      cartId: cart!.id,
      experienceId: input.experienceId,
      slotId: input.slotId,
      variationId: input.variationId ?? null,
      participantCount: input.participantCount,
      pricePerParticipantSnapshot: snapshot,
    })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.slotId],
      set: {
        participantCount: input.participantCount,
        variationId: input.variationId ?? null,
        pricePerParticipantSnapshot: snapshot,
        updatedAt: sql`now()`,
      },
    })
    .returning()

  return item!
}

export async function updateCartItem(
  db: DBOrTx,
  rawInput: UpdateCartItemInput,
): Promise<CartItem> {
  const input = UpdateCartItemSchema.parse(rawInput)

  // Ownership-scoped lookup (IDOR guard): the item must belong to THIS
  // customer's cart.
  const [row] = await db
    .select({
      id: cartItems.id,
      experienceId: cartItems.experienceId,
      variationId: cartItems.variationId,
    })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .where(
      and(eq(cartItems.id, input.cartItemId), eq(carts.customerUserId, input.customerUserId)),
    )
    .limit(1)
  if (!row) throw new CartError('ITEM_NOT_FOUND')

  const [exp] = await db
    .select({
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      pricePerPerson_3_5: experiences.pricePerPerson_3_5,
      pricePerPerson_6_plus: experiences.pricePerPerson_6_plus,
    })
    .from(experiences)
    .where(eq(experiences.id, row.experienceId))
    .limit(1)
  if (!exp) throw new CartError('ITEM_NOT_FOUND')

  let variationPrice: string | null = null
  if (row.variationId) {
    const [variation] = await db
      .select({ pricePerPerson: experiencePricingVariations.pricePerPerson })
      .from(experiencePricingVariations)
      .where(
        and(
          eq(experiencePricingVariations.id, row.variationId),
          // Symmetry with addToCart's VARIATION_MISMATCH guard.
          eq(experiencePricingVariations.experienceId, row.experienceId),
        ),
      )
      .limit(1)
    variationPrice = variation?.pricePerPerson ?? null
  }

  const snapshot = displayPrice(exp, variationPrice, input.participantCount)

  const [updated] = await db
    .update(cartItems)
    .set({
      participantCount: input.participantCount,
      pricePerParticipantSnapshot: snapshot,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(cartItems.id, row.id),
        // Re-scope by ownership at write time (TOCTOU defense — a
        // concurrent remove between the select and this update must yield
        // ITEM_NOT_FOUND, never a silent ok).
        sql`${cartItems.cartId} in (select ${carts.id} from ${carts} where ${carts.customerUserId} = ${input.customerUserId})`,
      ),
    )
    .returning()
  if (!updated) throw new CartError('ITEM_NOT_FOUND')
  return updated
}

const RemoveFromCartSchema = z.object({
  customerUserId: z.string().min(1),
  cartItemId: z.string().uuid(),
})

export async function removeFromCart(
  db: DBOrTx,
  rawInput: { customerUserId: string; cartItemId: string },
): Promise<void> {
  const input = RemoveFromCartSchema.parse(rawInput)
  const cartItemId = input.cartItemId

  const deleted = await db
    .delete(cartItems)
    .where(
      and(
        eq(cartItems.id, cartItemId),
        // Ownership scope (IDOR guard) via the customer's cart.
        sql`${cartItems.cartId} in (select ${carts.id} from ${carts} where ${carts.customerUserId} = ${input.customerUserId})`,
      ),
    )
    .returning({ id: cartItems.id })
  if (deleted.length === 0) throw new CartError('ITEM_NOT_FOUND')
}

export async function getCart(db: DBOrTx, customerUserId: string): Promise<CartView> {
  const rows = await db
    .select({
      id: cartItems.id,
      experienceId: cartItems.experienceId,
      experienceSlug: experiences.slug,
      experienceTitle: experiences.title,
      slotId: cartItems.slotId,
      slotStartAt: availabilitySlots.startAt,
      variationId: cartItems.variationId,
      variationName: experiencePricingVariations.name,
      participantCount: cartItems.participantCount,
      priceSnapshot: cartItems.pricePerParticipantSnapshot,
      createdAt: cartItems.createdAt,
    })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .innerJoin(experiences, eq(cartItems.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(cartItems.slotId, availabilitySlots.id))
    .leftJoin(
      experiencePricingVariations,
      eq(cartItems.variationId, experiencePricingVariations.id),
    )
    .where(eq(carts.customerUserId, customerUserId))
    .orderBy(cartItems.createdAt, cartItems.id)

  const items: CartLine[] = rows.map((r) => {
    // Math.floor — the PDP loader convention (detail-loader): the two
    // surfaces must show the same rupee figure for the same snapshot.
    const perPerson = Math.floor(Number(r.priceSnapshot))
    return {
      id: r.id,
      experienceId: r.experienceId,
      experienceSlug: r.experienceSlug,
      experienceTitle: r.experienceTitle,
      slotId: r.slotId,
      slotStartAtISO: r.slotStartAt.toISOString(),
      variationId: r.variationId,
      variationName: r.variationName,
      participantCount: r.participantCount,
      pricePerParticipantRupees: perPerson,
      lineTotalRupees: perPerson * r.participantCount,
    }
  })

  return {
    items,
    subtotalRupees: items.reduce((sum, i) => sum + i.lineTotalRupees, 0),
  }
}

export async function getCartCount(db: DBOrTx, customerUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(cartItems)
    .innerJoin(carts, eq(cartItems.cartId, carts.id))
    .where(eq(carts.customerUserId, customerUserId))
  return row?.n ?? 0
}
