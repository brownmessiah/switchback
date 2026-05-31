import { ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { verifiedVendorBadgeLabel } from '@/lib/vendor/dashboard-loader'

interface KycDisplayProps {
  kycTier: 'phone' | 'identity' | 'business'
  pan: string | null
  gstin: string | null
  udyamId: string | null
  aadhaarVerifiedAt: Date | null
  videoCallVerifiedAt: Date | null
}

const tierDescriptions: Record<string, string> = {
  phone: 'Signup only. Cannot publish Experiences or accept Bookings.',
  identity:
    'Aadhaar + PAN verified. Tier 2 caps apply (single-day, Rs 5K/person, 8 participants).',
  business:
    'Video call + GSTIN/Udyam verified. Unrestricted publishing and Bookings.',
}

// ADR-0007 verification ladder: the three milestones that move a Vendor from
// phone → identity → business. Completeness = how many are satisfied.
const TIER_RANK: Record<string, number> = {
  phone: 0,
  identity: 1,
  business: 2,
}

function formatDate(date: Date | null): string {
  if (!date) return 'Not verified'
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function maskPan(pan: string): string {
  if (pan.length <= 4) return pan
  return pan.slice(0, 2) + '*'.repeat(pan.length - 4) + pan.slice(-2)
}

export function KycDisplay({
  kycTier,
  pan,
  gstin,
  udyamId,
  aadhaarVerifiedAt,
  videoCallVerifiedAt,
}: KycDisplayProps) {
  // ADR-0007: distinct trust badges per tier (identity vs business) — never
  // overstate the level (rendering "Business verified" for an identity Vendor
  // is a trust-signal bug). phone/unknown → null = no verified badge.
  const verifiedLabel = verifiedVendorBadgeLabel(kycTier)

  // Completeness signal for the anchor-rail's verification section (#56 B,
  // folding in C's completeness): the verification ladder has three rungs.
  const rungs = [
    { label: 'Phone verified', done: true },
    { label: 'Identity verified', done: TIER_RANK[kycTier] >= 1 },
    { label: 'Business verified', done: TIER_RANK[kycTier] >= 2 },
  ]
  const doneCount = rungs.filter((r) => r.done).length
  const completionPct = Math.round((doneCount / rungs.length) * 100)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current tier + real verified status (paired icon, never color alone) */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Current tier
            </span>
            {verifiedLabel ? (
              <Badge variant="success" data-testid="verified-vendor-badge">
                <ShieldCheck aria-hidden="true" />
                {verifiedLabel}
              </Badge>
            ) : (
              <Badge variant="outline" className="capitalize">
                {kycTier}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {tierDescriptions[kycTier]}
          </p>
        </div>

        {/* Completeness signal — verification ladder progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Verification completeness</h4>
            <span className="text-sm text-muted-foreground tabular-nums">
              {doneCount}/{rungs.length} ({completionPct}%)
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={completionPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Verification completeness"
          >
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <ul className="space-y-1.5">
            {rungs.map((rung) => (
              <li
                key={rung.label}
                className="flex items-center gap-2 text-sm"
              >
                <span
                  aria-hidden="true"
                  className={
                    rung.done
                      ? 'inline-block size-2 rounded-full bg-success'
                      : 'inline-block size-2 rounded-full bg-muted-foreground/30'
                  }
                />
                <span
                  className={
                    rung.done ? 'text-foreground' : 'text-muted-foreground'
                  }
                >
                  {rung.label}
                  {rung.done ? '' : ' — not yet completed'}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Documents */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Submitted documents</h4>
          <div className="rounded-lg border">
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">PAN</span>
                <span className="text-sm font-mono text-muted-foreground tabular-nums">
                  {pan ? maskPan(pan) : 'Not provided'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">GSTIN</span>
                <span className="text-sm font-mono text-muted-foreground tabular-nums">
                  {gstin ?? 'Not provided'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Udyam ID</span>
                <span className="text-sm font-mono text-muted-foreground tabular-nums">
                  {udyamId ?? 'Not provided'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Verification timestamps */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Verification dates</h4>
          <div className="rounded-lg border">
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Aadhaar verification</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatDate(aadhaarVerifiedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Video call verification</span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatDate(videoCallVerifiedAt)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Upgrade notice */}
        {kycTier !== 'business' && (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">
              {kycTier === 'phone'
                ? 'Submit PAN and Aadhaar to upgrade to Identity tier.'
                : 'Complete a video call and submit GSTIN/Udyam to upgrade to Business tier.'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
