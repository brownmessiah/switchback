import { inArray } from 'drizzle-orm'
import { ArrowLeft, CalendarDays, Lock, MapPin, Users } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { getSlotBookingProgress } from '@/lib/trip-groups/booking-linkage'
import { TripGroupError } from '@/lib/trip-groups/errors'
import { getTripGroupWithRoster } from '@/lib/trip-groups/groups'
import { listItinerary } from '@/lib/trip-groups/itinerary'

import {
  AddSlotForm,
  DeleteSlotButton,
  HostRequestControls,
  JoinButton,
  LeaveButton,
  LockItineraryButton,
} from './group-detail-controls'

export default async function TripGroupDetailPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')
  const viewerId = session.user.id
  const { groupId } = await params

  let group: Awaited<ReturnType<typeof getTripGroupWithRoster>>['group']
  let roster: Awaited<ReturnType<typeof getTripGroupWithRoster>>['roster']
  try {
    const data = await getTripGroupWithRoster(db, groupId)
    group = data.group
    roster = data.roster
  } catch (err) {
    if (err instanceof TripGroupError && err.code === 'NOT_FOUND') notFound()
    throw err
  }

  const viewer = roster.find((m) => m.userId === viewerId)
  const isHost = group.hostUserId === viewerId
  const isActiveMember = viewer?.status === 'active'
  const isPending = viewer?.status === 'pending'
  const joinable =
    !viewer && (group.status === 'forming' || group.status === 'planning')

  // Member display names (host + roster) — names only, NEVER gender (privacy).
  const memberIds = roster.map((m) => m.userId)
  const nameRows = memberIds.length
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, memberIds))
    : []
  const nameById = new Map(nameRows.map((r) => [r.id, r.name]))

  const slots = await listItinerary(db, groupId)
  const progress = await getSlotBookingProgress(db, groupId)
  const bookedBySlot = new Map(progress.map((p) => [p.slotId, p.bookedByUserIds]))

  // Experience titles for grounded slots.
  const expIds = slots.map((s) => s.experienceId).filter((x): x is string => Boolean(x))
  const expRows = expIds.length
    ? await db
        .select({ id: experiences.id, title: experiences.title, slug: experiences.slug })
        .from(experiences)
        .where(inArray(experiences.id, expIds))
    : []
  const expById = new Map(expRows.map((r) => [r.id, r]))

  const pendingRequests = roster.filter((m) => m.status === 'pending')
  const activeMembers = roster.filter((m) => m.status === 'active')

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Link
        href="/community"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Community
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{group.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="secondary" className="capitalize">
              {group.status}
            </Badge>
            {group.visibility === 'public_women_only' && (
              <Badge variant="info">Women-only</Badge>
            )}
            {group.destinationSlugs.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden />
                {group.destinationSlugs.join(', ')}
              </span>
            )}
            {group.targetDateWindowStart && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden />
                {group.targetDateWindowStart}
                {group.targetDateWindowEnd ? ` – ${group.targetDateWindowEnd}` : ''}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {activeMembers.length}/{group.maxMembers}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {joinable && <JoinButton groupId={groupId} />}
          {isPending && <Badge variant="warning">Request pending</Badge>}
          {isActiveMember && !isHost && <LeaveButton groupId={groupId} />}
          {isHost && group.status === 'planning' && (
            <LockItineraryButton groupId={groupId} />
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem] lg:items-start">
        {/* Itinerary */}
        <section aria-label="Itinerary" className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Itinerary</h2>
            {group.status !== 'planning' && group.status !== 'forming' && (
              <Badge variant="outline">
                <Lock className="size-3" aria-hidden /> Locked
              </Badge>
            )}
          </div>

          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No itinerary yet. {isActiveMember ? 'Add the first plan below.' : ''}
            </p>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => {
                const exp = s.experienceId ? expById.get(s.experienceId) : null
                const booked = bookedBySlot.get(s.id) ?? []
                return (
                  <li key={s.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Day {s.dayOffset + 1} · {s.timeBand}
                        </p>
                        <p className="mt-0.5 text-sm font-medium">
                          {exp ? (
                            <Link
                              href={`/experience/${exp.slug}`}
                              className="text-primary-strong underline-offset-4 hover:underline"
                            >
                              {exp.title}
                            </Link>
                          ) : (
                            s.freeText
                          )}
                        </p>
                        {exp && booked.length > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {booked.length} member{booked.length === 1 ? '' : 's'} booked
                          </p>
                        )}
                      </div>
                      {isActiveMember &&
                        (group.status === 'planning' || group.status === 'forming') && (
                          <DeleteSlotButton slotId={s.id} groupId={groupId} />
                        )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {isActiveMember &&
            (group.status === 'planning' || group.status === 'forming') && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Add a plan</CardTitle>
                </CardHeader>
                <CardContent>
                  <AddSlotForm groupId={groupId} />
                </CardContent>
              </Card>
            )}
        </section>

        {/* Roster */}
        <aside aria-label="Members" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Members</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeMembers.map((m) => (
                <div key={m.userId} className="flex items-center justify-between text-sm">
                  <span>{nameById.get(m.userId) ?? 'Member'}</span>
                  {m.role === 'host' && <Badge variant="secondary">Host</Badge>}
                </div>
              ))}
            </CardContent>
          </Card>

          {isHost && pendingRequests.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Join requests</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingRequests.map((m) => (
                  <HostRequestControls
                    key={m.userId}
                    groupId={groupId}
                    memberUserId={m.userId}
                    memberName={nameById.get(m.userId) ?? 'Member'}
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </main>
  )
}
