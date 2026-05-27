import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { loadRegionClosures } from '@/lib/admin/region-closure-actions'

import { CreateClosureButton } from './closure-form'
import { DeleteClosureButton } from './delete-closure-button'

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function closureStatus(startAt: Date, endAt: Date): 'active' | 'upcoming' | 'past' {
  const now = new Date()
  if (now >= startAt && now <= endAt) return 'active'
  if (now < startAt) return 'upcoming'
  return 'past'
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  active: 'default',
  upcoming: 'secondary',
  past: 'outline',
}

// ── Page ────────────────────────────────────────────────────────────

export default async function RegionClosuresPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'region_closures')

  const closures = await loadRegionClosures(db)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Region Closures</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {closures.length} closure{closures.length === 1 ? '' : 's'}
          </p>
        </div>
        <CreateClosureButton />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Region</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {closures.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No region closures found.
                  </TableCell>
                </TableRow>
              ) : (
                closures.map((c) => {
                  const status = closureStatus(c.startAt, c.endAt)
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.regionSlug}</TableCell>
                      <TableCell className="text-sm">{formatDate(c.startAt)}</TableCell>
                      <TableCell className="text-sm">{formatDate(c.endAt)}</TableCell>
                      <TableCell className="text-sm max-w-[300px] truncate">
                        {c.reason}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-xs">
                          {c.source}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={STATUS_VARIANTS[status] ?? 'outline'}
                          className="capitalize text-xs"
                        >
                          {status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <DeleteClosureButton
                          closureId={c.id}
                          regionSlug={c.regionSlug}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
