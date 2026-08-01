import { CheckCircle2, Clock, XCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ApplicationStatusCardProps {
  status: 'pending' | 'approved' | 'rejected'
  /** The admin's stated reason on rejection. Null when none was recorded. */
  reason: string | null
  decidedAt: Date | null
}

/**
 * The Vendor's side of the admin accept/reject workflow.
 *
 * Before this, a rejected Vendor was told nothing: the decision lived only in
 * `audit_logs`, which they cannot see. They would keep drafting listings and
 * never learn why nothing could go live. Showing the decision — and the
 * admin's reason verbatim — is what makes "fix it and re-apply" possible.
 */
export function ApplicationStatusCard({
  status,
  reason,
  decidedAt,
}: ApplicationStatusCardProps) {
  const presentation = {
    pending: {
      Icon: Clock,
      variant: 'warning' as const,
      badge: 'Under review',
      headline: 'Your application is under review',
      body: 'Our team is checking your details. You can build and draft listings while you wait — they go live as soon as you are approved.',
    },
    approved: {
      Icon: CheckCircle2,
      variant: 'success' as const,
      badge: 'Approved',
      headline: 'Your account is approved',
      body: 'Submitted listings can now go live on outvers.com. Anything still in draft goes live once you submit it and it passes review.',
    },
    rejected: {
      Icon: XCircle,
      variant: 'destructive' as const,
      badge: 'Not approved',
      headline: 'Your application was not approved',
      body: 'Your listings stay in draft and cannot go live yet. Fix the issue below and re-apply — our team will take another look.',
    },
  }[status]

  const { Icon } = presentation

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Application status</CardTitle>
        <Badge variant={presentation.variant}>
          <Icon data-icon="inline-start" aria-hidden />
          {presentation.badge}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="font-medium">{presentation.headline}</p>
        <p className="text-sm text-muted-foreground">{presentation.body}</p>

        {status === 'rejected' && reason && (
          <div
            data-testid="application-decision-reason"
            className="space-y-1 rounded-[var(--radius-md)] border border-destructive/40 bg-destructive/5 px-3 py-2"
          >
            <p className="text-sm font-medium">Reason given</p>
            <p className="text-sm text-muted-foreground">{reason}</p>
          </div>
        )}

        {decidedAt && (
          <p className="text-xs text-muted-foreground">
            Decision recorded{' '}
            {new Date(decidedAt).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
