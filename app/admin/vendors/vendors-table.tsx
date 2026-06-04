import Link from 'next/link'

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
import { kycTierBadge } from '@/lib/admin/kyc-tier-badge'

/**
 * #87 — the admin vendors LIST as a rigorous DESIGN.md §4 A3 table:
 *  - KYC tier as a distinct-per-tier ramp via `kycTierBadge` (Business →
 *    success, Identity → info, Phone → warning) so the strongest tier is
 *    visually distinct instead of all-green — status color + paired icon,
 *    never color alone (DESIGN.md §1.3 / §5; ADR-0007 distinct labels)
 *  - numeric columns (Commission %, SLA %) right-aligned + `.tabular-nums`
 *    (DESIGN.md §1.3 / §2.2)
 *  - each row links to its `/admin/vendors/[id]` detail (B6 master → detail;
 *    the E2E navigates list → detail via `a[href*="/admin/vendors/"]`)
 *
 * No KYC approve/reject/suspend ACTIONS live on the LIST — those are on the
 * [id] detail (#101). The presentational table is split out so it is
 * unit-testable in isolation; the page owns the data load.
 */
export interface VendorsTableRow {
  userId: string
  businessName: string
  slug: string
  kycTier: string
  commissionRate: string | number
  responseTimeSlaScore: string | number
  suspended: boolean
  createdAt: Date | string
  userName: string | null
  userEmail: string | null
}

function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function VendorsTable({ rows }: { rows: VendorsTableRow[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <caption className="sr-only">Registered Vendors</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Business</TableHead>
              <TableHead scope="col">Contact</TableHead>
              <TableHead scope="col">KYC</TableHead>
              <TableHead scope="col" className="text-right">
                Commission
              </TableHead>
              <TableHead scope="col" className="text-right">
                SLA
              </TableHead>
              <TableHead scope="col">Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No vendors found.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((v) => (
                <TableRow
                  key={v.userId}
                  data-vendor-id={v.userId}
                  className="hover:bg-muted/50"
                >
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/vendors/${v.userId}`}
                      className="hover:underline"
                    >
                      {v.businessName}
                    </Link>
                    {v.suspended && (
                      <Badge variant="destructive" className="ml-2">
                        Suspended
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {v.userEmail ?? v.userName ?? '—'}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const kyc = kycTierBadge(v.kycTier)
                      const KycIcon = kyc.icon
                      return (
                        <Badge variant={kyc.variant}>
                          <KycIcon data-icon="inline-start" aria-hidden />
                          {kyc.label}
                        </Badge>
                      )
                    })()}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.floor(Number(v.commissionRate))}%
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {Math.floor(Number(v.responseTimeSlaScore))}%
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(v.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
