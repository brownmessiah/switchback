import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { availabilitySlots } from '@/db/schema/availability-slots'
import { cartItems, carts } from '@/db/schema/carts'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

import {
  addToCart,
  CartError,
  getCart,
  getCartCount,
  removeFromCart,
  updateCartItem,
} from './core'

/**
 * Customer cart core (home-redesign issue 11, ADR-0021).
 *
 * The cart is a SAVED LIST (never a Combo, never a money engine): each line
 * is (experience, slot, participants[, variation]) with a DISPLAY price
 * snapshot taken at add time. The authoritative price is still resolved and
 * snapshotted by createBooking at checkout (issue 12) — the cart snapshot
 * exists so the list renders stable prices, per the M2 snapshot rule.
 *
 * Contract highlights:
 *   - one cart per customer (lazily created on first add);
 *   - one line per (cart, slot): re-adding the same slot MERGES (updates
 *     count/variation + re-snapshots) rather than duplicating;
 *   - group-size bracket pricing feeds the snapshot (1-2 / 3-5 / 6+), or
 *     the variation's flat per-person price when one is chosen;
 *   - every mutation is ownership-scoped by customerUserId (IDOR-guarded);
 *   - integer-rupee subtotals (money conventions: no floats).
 */

describe('cart core (PGlite)', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let experienceId: string
  let otherExperienceId: string
  let slotId: string
  let slotSameExperienceId: string
  let otherSlotId: string
  let closedSlotId: string
  let variationId: string

  const DAY_MS = 24 * 60 * 60 * 1000

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    await db.insert(users).values([
      { id: 'u_vendor', email: 'v@test.com', name: 'Vendor' },
      { id: 'u_cust', email: 'c@test.com', name: 'Customer' },
      { id: 'u_other', email: 'o@test.com', name: 'Other Customer' },
    ])
    await db.insert(vendorProfiles).values([
      {
        userId: 'u_vendor',
        businessName: 'Cart Adventures',
        slug: 'cart-adventures',
        responseTimeSlaScore: '100.00',
      },
    ])
  })

  afterAll(async () => {
    await teardown()
  })

  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE cart_items, carts, availability_slots, experience_pricing_variations, experiences CASCADE`,
    )

    const [exp] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'rafting-cart-test',
        title: 'Rafting Cart Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '1500.00',
        pricePerPerson_3_5: '1300.00',
        pricePerPerson_6_plus: '1100.00',
        regionSlug: 'rishikesh',
        activitySlug: 'rafting',
        status: 'published',
      })
      .returning({ id: experiences.id })
    experienceId = exp!.id

    const [other] = await db
      .insert(experiences)
      .values({
        vendorUserId: 'u_vendor',
        slug: 'kayak-cart-test',
        title: 'Kayak Cart Test',
        cancellationPreset: 'flexible',
        paymentModesAllowed: ['full_upfront'],
        pricePerPerson_1_2: '900.00',
        pricePerPerson_3_5: '800.00',
        pricePerPerson_6_plus: '700.00',
        regionSlug: 'rishikesh',
        activitySlug: 'kayaking',
        status: 'published',
      })
      .returning({ id: experiences.id })
    otherExperienceId = other!.id

    async function slot(expId: string, offsetDays: number, status: 'open' | 'closed' = 'open') {
      const startAt = new Date(Date.now() + offsetDays * DAY_MS)
      const [row] = await db
        .insert(availabilitySlots)
        .values({
          experienceId: expId,
          startAt,
          endAt: new Date(startAt.getTime() + 4 * 3600 * 1000),
          capacity: 8,
          status,
        })
        .returning({ id: availabilitySlots.id })
      return row!.id
    }
    slotId = await slot(experienceId, 5)
    slotSameExperienceId = await slot(experienceId, 6)
    otherSlotId = await slot(otherExperienceId, 7)
    closedSlotId = await slot(experienceId, 8, 'closed')

    const [variation] = await db
      .insert(experiencePricingVariations)
      .values({
        experienceId,
        name: 'Sunrise premium',
        pricePerPerson: '2100.00',
      })
      .returning({ id: experiencePricingVariations.id })
    variationId = variation!.id
  })

  // ── Schema constraints ────────────────────────────────────────────────

  it('enforces ONE cart per customer (unique customer_user_id)', async () => {
    await db.insert(carts).values({ customerUserId: 'u_cust' })
    await expect(
      db.insert(carts).values({ customerUserId: 'u_cust' }),
    ).rejects.toThrow()
  })

  it('enforces one line per (cart, slot) and the participant bounds CHECK', async () => {
    const [cart] = await db
      .insert(carts)
      .values({ customerUserId: 'u_cust' })
      .returning({ id: carts.id })
    await db.insert(cartItems).values({
      cartId: cart!.id,
      experienceId,
      slotId,
      participantCount: 2,
      pricePerParticipantSnapshot: '1500.00',
    })
    await expect(
      db.insert(cartItems).values({
        cartId: cart!.id,
        experienceId,
        slotId,
        participantCount: 3,
        pricePerParticipantSnapshot: '1300.00',
      }),
    ).rejects.toThrow()
    await expect(
      db.insert(cartItems).values({
        cartId: cart!.id,
        experienceId,
        slotId: slotSameExperienceId,
        participantCount: 0,
        pricePerParticipantSnapshot: '1500.00',
      }),
    ).rejects.toThrow()
  })

  it('deleting a cart cascades to its items', async () => {
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    await db.delete(carts).where(eq(carts.customerUserId, 'u_cust'))
    const rows = await db.select().from(cartItems)
    expect(rows).toHaveLength(0)
  })

  // ── addToCart ─────────────────────────────────────────────────────────

  it('creates the cart lazily and snapshots the bracket price', async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    expect(item.pricePerParticipantSnapshot).toBe('1500.00')

    const item2 = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId: slotSameExperienceId,
      participantCount: 4,
    })
    // 3-5 bracket price.
    expect(item2.pricePerParticipantSnapshot).toBe('1300.00')

    const cartRows = await db.select().from(carts)
    expect(cartRows).toHaveLength(1)
  })

  it('re-adding the same slot MERGES into the existing line (no duplicates)', async () => {
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    const merged = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 6,
    })
    expect(merged.participantCount).toBe(6)
    // 6+ bracket re-snapshot.
    expect(merged.pricePerParticipantSnapshot).toBe('1100.00')

    const rows = await db.select().from(cartItems)
    expect(rows).toHaveLength(1)
  })

  it('snapshots the variation flat price when a variation is chosen', async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      variationId,
      participantCount: 4,
    })
    expect(item.pricePerParticipantSnapshot).toBe('2100.00')
  })

  it('rejects a slot that does not belong to the experience', async () => {
    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId: otherSlotId,
        participantCount: 2,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_MISMATCH' })
  })

  it('rejects closed and unknown slots', async () => {
    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId: closedSlotId,
        participantCount: 2,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_BOOKABLE' })
    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId: '00000000-0000-4000-8000-000000000000',
        participantCount: 2,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' })
  })

  it('rejects a variation that does not belong to the experience', async () => {
    const [foreignVariation] = await db
      .insert(experiencePricingVariations)
      .values({
        experienceId: otherExperienceId,
        name: 'Foreign',
        pricePerPerson: '999.00',
      })
      .returning({ id: experiencePricingVariations.id })

    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId,
        variationId: foreignVariation!.id,
        participantCount: 2,
      }),
    ).rejects.toMatchObject({ code: 'VARIATION_MISMATCH' })
  })

  it('validates participant bounds at the boundary (zod)', async () => {
    for (const participantCount of [0, 51, 2.5]) {
      await expect(
        addToCart(db, {
          customerUserId: 'u_cust',
          experienceId,
          slotId,
          participantCount,
        }),
      ).rejects.toThrow()
    }
  })

  // ── updateCartItem / removeFromCart (ownership-scoped) ───────────────

  it('updates participants and re-snapshots the bracket price', async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    const updated = await updateCartItem(db, {
      customerUserId: 'u_cust',
      cartItemId: item.id,
      participantCount: 7,
    })
    expect(updated.participantCount).toBe(7)
    expect(updated.pricePerParticipantSnapshot).toBe('1100.00')
  })

  it("refuses to touch another customer's item (IDOR)", async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    await expect(
      updateCartItem(db, {
        customerUserId: 'u_other',
        cartItemId: item.id,
        participantCount: 3,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
    await expect(
      removeFromCart(db, { customerUserId: 'u_other', cartItemId: item.id }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })

    // Untouched.
    const rows = await db.select().from(cartItems)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.participantCount).toBe(2)
  })

  it('removes an item', async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    await removeFromCart(db, { customerUserId: 'u_cust', cartItemId: item.id })
    expect(await getCartCount(db, 'u_cust')).toBe(0)
  })

  // ── getCart / getCartCount ────────────────────────────────────────────

  it('returns display rows + an integer-rupee subtotal', async () => {
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2, // 2 × 1500 = 3000
    })
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId: otherExperienceId,
      slotId: otherSlotId,
      participantCount: 4, // 4 × 800 = 3200
    })

    const cart = await getCart(db, 'u_cust')
    expect(cart.items).toHaveLength(2)
    expect(cart.subtotalRupees).toBe(6200)
    const titles = cart.items.map((i) => i.experienceTitle).sort()
    expect(titles).toEqual(['Kayak Cart Test', 'Rafting Cart Test'])
    for (const line of cart.items) {
      expect(line.slotStartAtISO).toMatch(/T/)
      expect(line.experienceSlug.length).toBeGreaterThan(0)
      expect(Number.isInteger(line.lineTotalRupees)).toBe(true)
    }
  })

  it('an empty (or absent) cart reads as zero', async () => {
    expect(await getCartCount(db, 'u_cust')).toBe(0)
    const cart = await getCart(db, 'u_cust')
    expect(cart.items).toHaveLength(0)
    expect(cart.subtotalRupees).toBe(0)
  })

  it('counts items per customer', async () => {
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId: slotSameExperienceId,
      participantCount: 2,
    })
    expect(await getCartCount(db, 'u_cust')).toBe(2)
    expect(await getCartCount(db, 'u_other')).toBe(0)
  })

  it('CartError carries a stable code', () => {
    const err = new CartError('SLOT_NOT_FOUND')
    expect(err.code).toBe('SLOT_NOT_FOUND')
    expect(err).toBeInstanceOf(Error)
  })

  // ── Review hardenings (issue-11 security + code review) ──────────────

  it('caps the cart at MAX_CART_LINES (bounds the issue-12 checkout transaction too)', async () => {
    // Fill to the cap with distinct slots.
    for (let i = 0; i < 25; i += 1) {
      const startAt = new Date(Date.now() + (30 + i) * DAY_MS)
      const [s] = await db
        .insert(availabilitySlots)
        .values({
          experienceId,
          startAt,
          endAt: new Date(startAt.getTime() + 3600 * 1000),
          capacity: 8,
        })
        .returning({ id: availabilitySlots.id })
      await addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId: s!.id,
        participantCount: 1,
      })
    }
    expect(await getCartCount(db, 'u_cust')).toBe(25)

    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId,
        participantCount: 1,
      }),
    ).rejects.toMatchObject({ code: 'CART_FULL' })

    // MERGING into an existing line is still allowed at the cap.
    const [firstItem] = await db.select().from(cartItems).limit(1)
    const merged = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId: firstItem!.experienceId,
      slotId: firstItem!.slotId,
      participantCount: 3,
    })
    expect(merged.participantCount).toBe(3)
  })

  it('floors fractional display prices (PDP loader convention, never rounds up)', async () => {
    await db
      .update(experiences)
      .set({ pricePerPerson_1_2: '1499.60' })
      .where(eq(experiences.id, experienceId))
    await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    const cart = await getCart(db, 'u_cust')
    expect(cart.items[0]!.pricePerParticipantRupees).toBe(1499)
    expect(cart.items[0]!.lineTotalRupees).toBe(2998)
  })

  it('rejects slots of unpublished experiences (wishlist-precedent gate)', async () => {
    await db
      .update(experiences)
      .set({ status: 'paused' })
      .where(eq(experiences.id, experienceId))
    await expect(
      addToCart(db, {
        customerUserId: 'u_cust',
        experienceId,
        slotId,
        participantCount: 2,
      }),
    ).rejects.toMatchObject({ code: 'SLOT_NOT_BOOKABLE' })
  })

  it('updateCartItem on a row deleted mid-flight throws ITEM_NOT_FOUND (never a silent ok)', async () => {
    const item = await addToCart(db, {
      customerUserId: 'u_cust',
      experienceId,
      slotId,
      participantCount: 2,
    })
    await db.delete(cartItems).where(eq(cartItems.id, item.id))
    await expect(
      updateCartItem(db, {
        customerUserId: 'u_cust',
        cartItemId: item.id,
        participantCount: 3,
      }),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_FOUND' })
  })
})
