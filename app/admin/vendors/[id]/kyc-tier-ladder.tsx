import { CheckCircle2Icon, CircleDotIcon, CircleIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * #101 Evidence Cockpit decision-rail — the KYC tier ladder (ADR-0007). The
 * three tiers progress in strict order phone → identity → business; the Vendor's
 * current tier is highlighted, earlier tiers read as complete, later tiers as
 * upcoming. This makes the promotion model visible instead of implied by a
 * single line of prose.
 */
const TIERS = [
  { tier: 'phone', label: 'Phone', sublabel: 'Signup OTP — cannot publish' },
  { tier: 'identity', label: 'Identity', sublabel: 'Aadhaar + tax ID — Identity verified Vendor' },
  { tier: 'business', label: 'Business', sublabel: 'Video call + GSTIN/Udyam — Business verified Vendor' },
] as const

type TierState = 'complete' | 'current' | 'upcoming'

const STATE_ICON = {
  complete: CheckCircle2Icon,
  current: CircleDotIcon,
  upcoming: CircleIcon,
} as const

export interface KycTierLadderProps {
  currentTier: string
}

export function KycTierLadder({ currentTier }: KycTierLadderProps) {
  const currentIndex = TIERS.findIndex((t) => t.tier === currentTier)

  return (
    <ol data-testid="kyc-tier-ladder" className="space-y-3">
      {TIERS.map((t, i) => {
        const state: TierState =
          i < currentIndex ? 'complete' : i === currentIndex ? 'current' : 'upcoming'
        const Icon = STATE_ICON[state]
        return (
          <li
            key={t.tier}
            data-testid={`kyc-tier-step-${t.tier}`}
            data-tier={t.tier}
            data-state={state}
            className={cn(
              'flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2',
              state === 'current' && 'border-primary-strong bg-primary/5',
              state === 'complete' && 'border-success/40',
              state === 'upcoming' && 'border-border opacity-70',
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                'mt-0.5 size-4 shrink-0',
                state === 'complete' && 'text-success',
                state === 'current' && 'text-primary-strong',
                state === 'upcoming' && 'text-muted-foreground',
              )}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium leading-tight">
                {t.label}
                {state === 'current' && (
                  <span className="ml-2 text-xs font-normal text-primary-strong">
                    Current
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{t.sublabel}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
