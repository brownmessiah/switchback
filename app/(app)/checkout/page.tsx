import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { and } from 'drizzle-orm'

import { db } from '@/db/client'
import { availabilitySlots, experiences } from '@/db/schema'
import { experiencePricingVariations } from '@/db/schema/experience-pricing-variations'
import { auth } from '@/lib/auth'

import { CheckoutForm } from './checkout-form'

/** Upper bound for the participant stepper when no slot capacity is known. */
const PARTICIPANT_CAP = 12

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CheckoutPage({ searchParams }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/sign-in')
  }

  const params = await searchParams
  const experienceId = typeof params.experienceId === 'string' ? params.experienceId : null
  const slotId = typeof params.slotId === 'string' ? params.slotId : null
  const tripGroupId =
    typeof params.tripGroupId === 'string' ? params.tripGroupId : null
  // Selected pricing variation (issue #08). Carried from the PDP selector; the
  // SERVER resolves + snapshots its price at Booking-create (the client never
  // sends a price). An invalid/foreign/inactive id is rejected server-side.
  const variationId = typeof params.variationId === 'string' ? params.variationId : null
  const participantCount = typeof params.participants === 'string'
    ? parseInt(params.participants, 10)
    : 2

  if (!experienceId) notFound()

  const [experienceRow] = await db
    .select()
    .from(experiences)
    .where(eq(experiences.id, experienceId))
    .limit(1)

  if (!experienceRow || experienceRow.status !== 'published') notFound()

  const bracketPrices = {
    tier12: Number(experienceRow.pricePerPerson_1_2),
    tier35: Number(experienceRow.pricePerPerson_3_5),
    tier6: Number(experienceRow.pricePerPerson_6_plus),
  }

  // Resolve the selected pricing variation (issue #08) for DISPLAY. We re-check
  // it is ACTIVE and belongs to this Experience — a stale/foreign/inactive id
  // is dropped (treated as standard pricing) here, and createBooking would
  // reject it server-side anyway. The displayed per-person price is the
  // variation's; the SERVER snapshots the authoritative value.
  let selectedVariation: { id: string; name: string; pricePerPersonRupees: number } | null =
    null
  if (variationId) {
    const [variationRow] = await db
      .select({
        id: experiencePricingVariations.id,
        name: experiencePricingVariations.name,
        pricePerPerson: experiencePricingVariations.pricePerPerson,
      })
      .from(experiencePricingVariations)
      .where(
        and(
          eq(experiencePricingVariations.id, variationId),
          eq(experiencePricingVariations.experienceId, experienceId),
          eq(experiencePricingVariations.isActive, true),
        ),
      )
      .limit(1)
    if (variationRow) {
      selectedVariation = {
        id: variationRow.id,
        name: variationRow.name,
        pricePerPersonRupees: Math.floor(Number(variationRow.pricePerPerson)),
      }
    }
  }

  // Bound the participant stepper by the selected slot's remaining capacity
  // (createBooking is the authoritative guard — it rejects INSUFFICIENT_CAPACITY
  // — but bounding the UI avoids a guaranteed-failed submit).
  let maxParticipants = PARTICIPANT_CAP
  if (slotId) {
    const [slotRow] = await db
      .select({ capacity: availabilitySlots.capacity, capacityTaken: availabilitySlots.capacityTaken })
      .from(availabilitySlots)
      .where(eq(availabilitySlots.id, slotId))
      .limit(1)
    if (slotRow) {
      maxParticipants = Math.max(1, slotRow.capacity - slotRow.capacityTaken)
    }
  }

  // Clamp the initial count into [1, maxParticipants]; the form re-resolves the
  // price bracket + totals live as the customer changes it.
  const initialCount = Math.min(Math.max(1, participantCount), maxParticipants)

  return (
    <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <h1 className="mb-8 font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
        Checkout
      </h1>

      <CheckoutForm
        experienceId={experienceId}
        experienceTitle={experienceRow.title}
        slotId={slotId}
        tripGroupId={tripGroupId}
        participantCount={initialCount}
        maxParticipants={maxParticipants}
        priceTier12={bracketPrices.tier12}
        priceTier35={bracketPrices.tier35}
        priceTier6={bracketPrices.tier6}
        variationId={selectedVariation?.id ?? null}
        variationName={selectedVariation?.name ?? null}
        variationPricePerPerson={selectedVariation?.pricePerPersonRupees ?? null}
        cancellationPreset={experienceRow.cancellationPreset}
        paymentModesAllowed={experienceRow.paymentModesAllowed as string[]}
        customerName={session.user.name ?? null}
        customerEmail={session.user.email ?? null}
      />
    </main>
  )
}
