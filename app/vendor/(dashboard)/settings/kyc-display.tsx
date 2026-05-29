import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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

const tierVariant: Record<string, 'default' | 'secondary' | 'outline'> = {
  phone: 'outline',
  identity: 'secondary',
  business: 'default',
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>KYC verification</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current tier */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">
              Current tier
            </span>
            <Badge variant={tierVariant[kycTier]} className="capitalize">
              {kycTier}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tierDescriptions[kycTier]}
          </p>
        </div>

        {/* Documents */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium">Submitted documents</h4>
          <div className="rounded-lg border">
            <div className="divide-y">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">PAN</span>
                <span className="text-sm font-mono text-muted-foreground">
                  {pan ? maskPan(pan) : 'Not provided'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">GSTIN</span>
                <span className="text-sm font-mono text-muted-foreground">
                  {gstin ?? 'Not provided'}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Udyam ID</span>
                <span className="text-sm font-mono text-muted-foreground">
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
                <span className="text-sm text-muted-foreground">
                  {formatDate(aadhaarVerifiedAt)}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-sm">Video call verification</span>
                <span className="text-sm text-muted-foreground">
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
