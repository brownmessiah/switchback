import { asc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { bookings } from '@/db/schema/bookings'
import { cartItems, carts } from '@/db/schema/carts'
import { orders } from '@/db/schema/orders'
import { writeAuditLog } from '@/lib/audit/write'
import { BookingCreateError, createBooking } from '@/lib/payments/booking-create'
import type { DBOrTx } from '@/lib/payments/commission-resolver'
import { createOrder } from '@/lib/payments/razorpay-client'
import { applyWalletToOrder } from '@/lib/payments/wallet'
import { getRedis } from '@/lib/redis'

/**
 * Multi-item cart checkout (home-redesign issue 12, ADR-0021).
 *
 * The cart is a thin orchestration layer over the EXISTING per-booking
 * money engine: each line runs through `createBooking` (its own
 * commission / GST / TCS / 194-O / price snapshots, nesting as a
 * savepoint) under ONE outer transaction — all-or-nothing. v1 coerces
 * every line to `full_upfront` (partial-pay-in-cart is the documented v2).
 *
 * Money-critical invariants (see .scratch/home-redesign/MONEY-PATH-BRIEF.md):
 *   - Per-item `createBooking` idempotency keys are FRESH UUIDs on every
 *     attempt. createBooking caches its Redis key when its own savepoint
 *     resolves — BEFORE the outer commit — so a rolled-back attempt leaves
 *     dangling cache entries; reusing derived keys across retries would
 *     resurrect bookings that never committed. Action-level dedup is THIS
 *     module's Redis key, set strictly AFTER the outer commit.
 *   - Items are processed in DETERMINISTIC order (created_at, then id) so
 *     the FY-cumulative 194-O ₹5L threshold crosses reproducibly
 *     (createBooking's FY aggregation sees earlier same-cart inserts
 *     inside the uncommitted transaction).
 *   - The wallet applies ONCE at order level in the ADR-0004 spend order,
 *     inside the outer tx (rollback restores balances), attributed
 *     per-booking via audit rows.
 *   - The Razorpay order (one for the whole cart, notes.order_id) is
 *     created AFTER the commit — an external call never runs inside the
 *     DB transaction. If it fails post-commit, the bookings + order exist
 *     unpaid (`paymentSetupFailed: true`, same exposure class as the
 *     single-item flow when Razorpay fails after createBooking).
 */

export type CartCheckoutErrorCode =
  | 'CART_EMPTY'
  | 'ITEM_FAILED'
  | 'CHECKOUT_IN_PROGRESS'
  | 'unknown'

export class CartCheckoutError extends Error {
  readonly code: CartCheckoutErrorCode

  constructor(code: CartCheckoutErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'CartCheckoutError'
    this.code = code
  }
}

const InputSchema = z.object({
  customerUserId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  acknowledgedPermits: z.boolean().optional().default(false),
})
export type CartCheckoutInput = z.input<typeof InputSchema>

export interface CartCheckoutSuccess {
  ok: true
  orderId: string
  razorpayOrderId: string | null
  amountTotalRupees: number
  razorpayRemainderRupees: number
  bookingIds: string[]
  walletApplied: {
    switchbackCreditAppliedRupees: number
    refundBalanceAppliedRupees: number
  }
  /** Set when the post-commit Razorpay order creation failed (retryable). */
  paymentSetupFailed?: boolean
  /** Set when this call was answered from the idempotency cache. */
  replayed?: boolean
}

export interface CartCheckoutFailure {
  ok: false
  error: CartCheckoutErrorCode
  message: string
  /** The slot of the line item that aborted the checkout, when known. */
  failedSlotId?: string
  failedCode?: string
}

export type CartCheckoutResult = CartCheckoutSuccess | CartCheckoutFailure

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60

export async function executeCartCheckout(
  db: DBOrTx,
  rawInput: CartCheckoutInput,
): Promise<CartCheckoutResult> {
  const input = InputSchema.parse(rawInput)

  // Action-level idempotency: a retried submit returns the SAME order and
  // never re-runs the money path. Set strictly AFTER the outer commit.
  const redis = getRedis()
  // User-scoped: a leaked/guessed key must never disclose another
  // customer's order. Keys are per-click, so a same-key replay correctly
  // returns the ORIGINAL order even if the cart has been refilled since.
  const idemKey = `cart-checkout:${input.customerUserId}:${input.idempotencyKey}`
  const cached = await redis.get(idemKey)
  if (cached) {
    try {
      const stored = JSON.parse(cached) as CartCheckoutSuccess
      if (stored && stored.ok === true && typeof stored.orderId === 'string') {
        return { ...stored, replayed: true }
      }
    } catch {
      // Corrupt cache entry = cache miss; the money path re-runs safely
      // (per-item keys are fresh, the NX lock guards concurrency).
    }
    await redis.del(idemKey)
  }

  // Per-user in-flight lock (H1): a double-click or second tab mints a
  // FRESH key, so the idempotency cache alone cannot dedupe concurrent
  // submits — SET NX turns them away while one checkout is running.
  const lockKey = `cart-checkout-lock:${input.customerUserId}`
  const lock = await redis.set(lockKey, input.idempotencyKey, { nx: true, ex: 120 })
  if (lock === null) {
    return {
      ok: false,
      error: 'CHECKOUT_IN_PROGRESS',
      message: 'A checkout is already in progress for your cart.',
    }
  }

  let failed: { slotId: string; code: string } | null = null

  try {
    const txResult = await db.transaction(async (tx) => {
      // Lock the cart row and read the lines INSIDE the transaction (H1 +
      // TOCTOU): concurrent submits serialize here, and the loser sees the
      // emptied cart. Deterministic order (created_at, then id) is
      // load-bearing for the reproducible 194-O threshold crossing.
      const [cartRow] = await tx
        .select({ id: carts.id })
        .from(carts)
        .where(eq(carts.customerUserId, input.customerUserId))
        .for('update')
      if (!cartRow) throw new CartCheckoutError('CART_EMPTY')

      const lines = await tx
        .select({
          id: cartItems.id,
          experienceId: cartItems.experienceId,
          slotId: cartItems.slotId,
          variationId: cartItems.variationId,
          participantCount: cartItems.participantCount,
        })
        .from(cartItems)
        .where(eq(cartItems.cartId, cartRow.id))
        .orderBy(asc(cartItems.createdAt), asc(cartItems.id))
      if (lines.length === 0) throw new CartCheckoutError('CART_EMPTY')

      const bookingIds: string[] = []
      for (const line of lines) {
        try {
          const res = await createBooking(tx, {
            customerUserId: input.customerUserId,
            experienceId: line.experienceId,
            slotId: line.slotId,
            participantCount: line.participantCount,
            variationId: line.variationId ?? undefined,
            // ADR-0021 v1: every cart line is coerced to full upfront.
            paymentMode: 'full_upfront',
            acknowledgedPermits: input.acknowledgedPermits,
            // FRESH key per line per ATTEMPT — see module doc.
            idempotencyKey: crypto.randomUUID(),
          })
          bookingIds.push(res.bookingId)
        } catch (err) {
          if (err instanceof BookingCreateError) {
            failed = { slotId: line.slotId, code: err.code }
          }
          throw err // aborts the OUTER transaction — all-or-nothing.
        }
      }

      // Per-booking gross (authoritative snapshots createBooking just wrote).
      const grossRows = await tx
        .select({ id: bookings.id, gross: bookings.grossTotalSnapshot })
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
      const grossById = new Map(
        grossRows.map((r) => [r.id, Math.floor(Number(r.gross))]),
      )
      const amountTotalRupees = bookingIds.reduce((sum, id) => {
        const gross = grossById.get(id)
        if (gross === undefined) {
          // Unreachable (same-tx select right after insert) — but a silent
          // ₹0 line in an order total is exactly the failure that must be
          // loud, not defaulted.
          throw new Error(`gross snapshot missing for booking ${id}`)
        }
        return sum + gross
      }, 0)

      const [order] = await tx
        .insert(orders)
        .values({
          customerUserId: input.customerUserId,
          amountTotalSnapshot: amountTotalRupees.toFixed(2),
        })
        .returning({ id: orders.id })

      // Backfill the envelope link (order_id is NOT snapshot-locked).
      await tx
        .update(bookings)
        .set({ orderId: order!.id, updatedAt: sql`now()` })
        .where(inArray(bookings.id, bookingIds))

      // Wallet ONCE at order level (ADR-0004 order), per-booking audit rows.
      const wallet = await applyWalletToOrder(tx, {
        userId: input.customerUserId,
        orderId: order!.id,
        lines: bookingIds.map((id) => ({
          bookingId: id,
          grossRupees: grossById.get(id)!,
        })),
      })

      // M3: a fully wallet-funded order settles here — no Razorpay order,
      // no webhook — so it is PAID the moment the tx commits.
      if (wallet.razorpayRemainderRupees === 0) {
        await tx
          .update(orders)
          .set({ state: 'paid', updatedAt: sql`now()` })
          .where(eq(orders.id, order!.id))
      }

      await writeAuditLog(tx, {
        actorUserId: input.customerUserId,
        action: 'order.create',
        entityType: 'order',
        entityId: order!.id,
        payload: {
          orderId: order!.id,
          bookingIds,
          amountTotalRupees,
          switchbackCreditAppliedRupees: wallet.switchbackCreditAppliedRupees,
          refundBalanceAppliedRupees: wallet.refundBalanceAppliedRupees,
          razorpayRemainderRupees: wallet.razorpayRemainderRupees,
        },
      })

      // Clear the cart on success — inside the tx, so a rollback keeps it.
      await tx.delete(cartItems).where(
        inArray(
          cartItems.id,
          lines.map((l) => l.id),
        ),
      )

      return { orderId: order!.id, bookingIds, amountTotalRupees, wallet }
    })

    // ── Post-commit: the ONE Razorpay order (external call — never inside
    // the DB transaction). notes.order_id drives the webhook's order path.
    let razorpayOrderId: string | null = null
    let paymentSetupFailed = false
    if (txResult.wallet.razorpayRemainderRupees > 0) {
      try {
        const rzpOrder = await createOrder({
          amountRupees: txResult.wallet.razorpayRemainderRupees,
          notes: {
            order_id: txResult.orderId,
            customer_user_id: input.customerUserId,
          },
        })
        razorpayOrderId = rzpOrder.orderId
        await db
          .update(orders)
          .set({ razorpayOrderId, updatedAt: sql`now()` })
          .where(eq(orders.id, txResult.orderId))
      } catch (err) {
        // Bookings + order are committed; the charge setup can be retried.
        // Same exposure class as the single-item flow's post-booking
        // Razorpay failure — surfaced honestly, never rolled back.
        console.error('[cart-checkout] Razorpay order creation failed post-commit', err)
        paymentSetupFailed = true
      }
    }

    const result: CartCheckoutSuccess = {
      ok: true,
      orderId: txResult.orderId,
      razorpayOrderId,
      amountTotalRupees: txResult.amountTotalRupees,
      razorpayRemainderRupees: txResult.wallet.razorpayRemainderRupees,
      bookingIds: txResult.bookingIds,
      walletApplied: {
        switchbackCreditAppliedRupees: txResult.wallet.switchbackCreditAppliedRupees,
        refundBalanceAppliedRupees: txResult.wallet.refundBalanceAppliedRupees,
      },
      ...(paymentSetupFailed ? { paymentSetupFailed: true } : {}),
    }
    try {
      // Best-effort (M1): the money is committed — a Redis blip here must
      // never surface as "nothing was charged". Losing the cache entry is
      // safe (keys are per-submit).
      await redis.set(idemKey, JSON.stringify(result), {
        ex: IDEMPOTENCY_TTL_SECONDS,
      })
    } catch (cacheErr) {
      console.error('[cart-checkout] idempotency cache write failed post-commit', cacheErr)
    }
    return result
  } catch (err) {
    if (err instanceof CartCheckoutError) {
      return {
        ok: false,
        error: err.code,
        message:
          err.code === 'CART_EMPTY'
            ? 'Your cart is empty.'
            : 'Checkout failed. Nothing was charged — please try again.',
      }
    }
    if (failed !== null) {
      const failure = failed as { slotId: string; code: string }
      // Rejection audit on the TOP-LEVEL handle (the tx rolled back) naming
      // the failing item (ADR-0021).
      await writeAuditLog(db, {
        actorUserId: input.customerUserId,
        action: 'order.reject',
        entityType: 'cart',
        entityId: input.customerUserId,
        payload: { failedSlotId: failure.slotId, code: failure.code },
      })
      return {
        ok: false,
        error: 'ITEM_FAILED',
        message: 'One of your cart items can no longer be booked.',
        failedSlotId: failure.slotId,
        failedCode: failure.code,
      }
    }
    console.error('[cart-checkout] checkout failed', err)
    return {
      ok: false,
      error: 'unknown',
      message: 'Checkout failed. Nothing was charged — please try again.',
    }
  } finally {
    try {
      await redis.del(lockKey)
    } catch {
      // The 120s TTL is the backstop if Redis refuses the delete.
    }
  }
}
