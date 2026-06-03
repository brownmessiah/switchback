import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { experiences, mediaAssets } from '@/db/schema'
import { auth } from '@/lib/auth'
import { loadItinerary } from '@/lib/experiences/itinerary'

import { ExperienceEditForm } from './experience-edit-form'

interface EditPageProps {
  params: Promise<{ id: string }>
}

export default async function ExperienceEditPage({ params }: EditPageProps) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()

  const [experience] = await db
    .select()
    .from(experiences)
    .where(eq(experiences.id, id))
    .limit(1)

  if (!experience || experience.vendorUserId !== session.user.id) {
    notFound()
  }

  const images = await db
    .select({
      id: mediaAssets.id,
      url: mediaAssets.url,
      storageKey: mediaAssets.storageKey,
    })
    .from(mediaAssets)
    .where(eq(mediaAssets.entityId, id))

  // ADR-0017 — pre-load the Vendor-authored itinerary so the edit form's
  // itinerary editor round-trips the saved steps (ordered by stepOrder).
  const itinerary = await loadItinerary(db, id)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit experience</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Update &ldquo;{experience.title}&rdquo;
        </p>
      </div>
      <ExperienceEditForm
        experience={experience}
        initialImages={images}
        initialItinerary={itinerary}
      />
    </div>
  )
}
