import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { availabilityPatterns } from '@/db/schema/availability-patterns'
import { experiences } from '@/db/schema/experiences'
import { auth } from '@/lib/auth'

import { AvailabilityManager } from './availability-manager'

interface AvailabilityPageProps {
  params: Promise<{ id: string }>
}

export default async function AvailabilityPage({ params }: AvailabilityPageProps) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()

  const [experience] = await db
    .select({
      id: experiences.id,
      title: experiences.title,
      regionSlug: experiences.regionSlug,
      vendorUserId: experiences.vendorUserId,
    })
    .from(experiences)
    .where(eq(experiences.id, id))
    .limit(1)

  if (!experience || experience.vendorUserId !== session.user.id) {
    notFound()
  }

  const patterns = await db
    .select()
    .from(availabilityPatterns)
    .where(eq(availabilityPatterns.experienceId, id))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage availability for &ldquo;{experience.title}&rdquo;
        </p>
      </div>
      <AvailabilityManager
        experienceId={experience.id}
        regionSlug={experience.regionSlug}
        initialPatterns={patterns.map((p) => ({
          id: p.id,
          dayOfWeek: p.dayOfWeek,
          startTime: p.startTime,
          endTime: p.endTime,
          capacity: p.capacity,
          effectiveFrom: p.effectiveFrom,
          effectiveUntil: p.effectiveUntil,
        }))}
      />
    </div>
  )
}
