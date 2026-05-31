import { Card, CardContent } from '@/components/ui/card'

import { AdminStatusBadge } from '../../_components/admin-status-badge'

/**
 * #101 Evidence Cockpit — one left-pane document card per REAL KYC evidence
 * field on `vendor_profiles`. There is NO fabricated evidence: a card only ever
 * surfaces the field handed to it.
 *
 * Two field shapes, three states:
 *  - kind="value"     (pan / gstin / udyamId): a present string → "Submitted"
 *    (awaiting review); null → "Not submitted".
 *  - kind="timestamp" (aadhaarVerifiedAt / videoCallVerifiedAt): a present date
 *    → "Verified" (the verification happened, with its date as evidence); null →
 *    "Not submitted".
 *
 * The state is rendered via the shared `AdminStatusBadge` so it pairs a semantic
 * colour WITH a paired icon — never colour alone, never the bare em-dash that
 * was the "before" defect (DESIGN.md §1.3 r2 / §5).
 */
export type VendorEvidenceCardProps =
  | {
      testId: string
      label: string
      kind: 'value'
      value: string | null | undefined
    }
  | {
      testId: string
      label: string
      kind: 'timestamp'
      verifiedAt: Date | null | undefined
    }

function formatVerifiedDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

interface EvidenceState {
  /** AdminStatusBadge status key (colour + paired icon). */
  status: string
  label: string
  /** The reviewable evidence text shown in the card body. */
  evidence: string
  /** True when nothing was submitted — drives the muted empty body. */
  empty: boolean
}

function resolveState(props: VendorEvidenceCardProps): EvidenceState {
  if (props.kind === 'timestamp') {
    if (props.verifiedAt) {
      return {
        status: 'approved',
        label: 'Verified',
        evidence: `Verified ${formatVerifiedDate(props.verifiedAt)}`,
        empty: false,
      }
    }
    return { status: 'phone', label: 'Not submitted', evidence: 'No verification on record.', empty: true }
  }

  const value = props.value?.trim()
  if (value) {
    return { status: 'pending', label: 'Submitted', evidence: value, empty: false }
  }
  return { status: 'phone', label: 'Not submitted', evidence: 'No document on record.', empty: true }
}

export function VendorEvidenceCard(props: VendorEvidenceCardProps) {
  const { testId, label } = props
  const state = resolveState(props)

  return (
    <Card data-testid={testId} className="shadow-[var(--shadow-sm)]">
      <CardContent className="flex items-start justify-between gap-4 pt-6">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
            {label}
          </p>
          <p
            className={
              state.empty
                ? 'text-sm italic text-muted-foreground'
                : 'truncate font-mono text-sm text-foreground'
            }
          >
            {state.evidence}
          </p>
        </div>
        <span data-testid={`${testId}-state`} className="shrink-0">
          <AdminStatusBadge status={state.status} label={state.label} />
        </span>
      </CardContent>
    </Card>
  )
}
