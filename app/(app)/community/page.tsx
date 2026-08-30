import { MapPin, Users } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { listPublicGroups, type DiscoveryFilters } from '@/lib/trip-groups/discovery'

import { CreateGroupForm } from './create-group-form'

/**
 * `/community` — TripGroup discovery + create (ADR-0009). Auth-gated customer
 * surface (in EXCLUDED_PREFIXES). Lists public, still-joinable groups with
 * intent filters; the women-verified-hosts filter is a query param. Copy is
 * English-only for v1 (i18n namespace deferred — see issue #20 notes).
 */
export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Public browse (parity with switchback.com Community): anyone can see open trip
  // groups; signing in is only required to CONVENE or JOIN one.
  const session = await auth.api.getSession({ headers: await headers() })

  const sp = await searchParams
  const str = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v
  const filters: DiscoveryFilters = {
    destinationSlug: str(sp.destination),
    interestTag: str(sp.interest),
    womenVerifiedHostsOnly: str(sp.women) === '1',
  }
  const groups = await listPublicGroups(db, filters)

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Community</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Find people heading where you want to go, or convene your own trip. Each
          member books their own seat — your payment, refund and KYC always stay
          yours.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <section aria-label="Open trip groups" className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">Open trip groups</h2>
            <Link
              href={filters.womenVerifiedHostsOnly ? '/community' : '/community?women=1'}
              className="text-sm font-medium text-primary-strong underline-offset-4 hover:underline"
            >
              {filters.womenVerifiedHostsOnly
                ? 'Show all hosts'
                : 'Women-verified hosts only'}
            </Link>
          </div>

          {groups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No open trip groups match yet. Be the first to convene one →
              </CardContent>
            </Card>
          ) : (
            <ul className="space-y-3">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link href={`/community/${g.id}`} className="block">
                    <Card className="transition hover:border-foreground/20 hover:shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">{g.name}</CardTitle>
                          {g.visibility === 'public_women_only' && (
                            <Badge variant="info" className="shrink-0">
                              Women-only
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {g.destinationSlugs.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5" aria-hidden />
                            {g.destinationSlugs.join(', ')}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5" aria-hidden />
                          {g.activeMemberCount}/{g.maxMembers}
                        </span>
                        <Badge variant="secondary" className="capitalize">
                          {g.status}
                        </Badge>
                        {g.interestTags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </CardContent>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside aria-label="Create a trip group" className="lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Convene a trip</CardTitle>
            </CardHeader>
            <CardContent>
              {session?.user ? (
                <CreateGroupForm />
              ) : (
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Sign in to convene your own trip and invite others to book
                    alongside you — each member still pays for their own seat.
                  </p>
                  <Link href="/sign-in" className={buttonVariants({ className: 'w-full' })}>
                    Sign in to convene
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </main>
  )
}
