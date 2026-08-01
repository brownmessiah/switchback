import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { VendorKycDocument } from '@/db/schema/vendor-kyc-documents'
import type { KycDocumentKind } from '@/lib/vendor/kyc-documents'

import { KycDocumentUpload } from './kyc-document-upload'

/**
 * The ADR-0007 interim verification evidence set.
 *
 * ADR-0007's Tier-2 gate assumes Aadhaar OTP eKYC, which is not integrated, so
 * the ADR's documented fallback — PAN + government ID + selfie reviewed
 * manually — is the live path. This card is where a Vendor supplies it.
 */
const SLOTS: { kind: KycDocumentKind; label: string; hint: string }[] = [
  {
    kind: 'government_id',
    label: 'Government ID',
    hint: 'Aadhaar, passport, voter ID or driving licence. Photo or PDF.',
  },
  {
    kind: 'selfie',
    label: 'Selfie holding your ID',
    hint: 'A clear photo of you holding the same ID, so we can match the two.',
  },
  {
    kind: 'pan_card',
    label: 'PAN card',
    hint: 'Required for payouts and TDS reporting.',
  },
  {
    kind: 'business_proof',
    label: 'Business proof (optional)',
    hint: 'GSTIN certificate or Udyam registration. Needed for Business verification.',
  },
]

export function KycDocumentsCard({ documents }: { documents: VendorKycDocument[] }) {
  const byKind = new Map(documents.map((doc) => [doc.kind, doc]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Verification documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Our team reviews these manually. Upload what you have — you can add the rest
          later, and replace anything that did not scan well.
        </p>
        <p className="text-xs text-muted-foreground">
          Stored privately and visible only to our verification team. They are never
          shown on your public profile.
        </p>

        {SLOTS.map((slot) => {
          const existing = byKind.get(slot.kind)
          return (
            <KycDocumentUpload
              key={slot.kind}
              kind={slot.kind}
              label={slot.label}
              hint={slot.hint}
              uploaded={
                existing
                  ? {
                      originalFilename: existing.originalFilename,
                      uploadedAt: existing.createdAt,
                    }
                  : null
              }
            />
          )
        })}
      </CardContent>
    </Card>
  )
}
