import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { loadRegionClosures } from '@/lib/admin/region-closure-actions'

import { CreateClosureButton } from './closure-form'
import { ClosuresTable, type ClosureTableRow } from './closures-table'

// ── Page ────────────────────────────────────────────────────────────

export default async function RegionClosuresPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'region_closures')

  const closures = await loadRegionClosures(db)

  const rows: ClosureTableRow[] = closures.map((c) => ({
    id: c.id,
    regionSlug: c.regionSlug,
    startAt: c.startAt,
    endAt: c.endAt,
    reason: c.reason,
    source: c.source,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Region Closures</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} closure{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <CreateClosureButton />
      </div>

      <ClosuresTable rows={rows} />
    </div>
  )
}
