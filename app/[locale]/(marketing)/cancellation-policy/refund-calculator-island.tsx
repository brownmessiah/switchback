'use client'

import { useTranslations } from 'next-intl'
import { useId, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleSlash,
  Clock,
  TriangleAlert,
  Wallet,
} from 'lucide-react'

import {
  computeRefundQuote,
  type CalculablePreset,
} from './refund-calculator'

/**
 * Interactive Refund Calculator hero (#68, Direction B "The Refund Calculator").
 *
 * Lets a logged-out Customer enter a booking total, a Cancellation preset, and
 * the two timestamps (Experience start + when they'd cancel), then renders the
 * EXACT refund the money path would pay — by delegating to `computeRefundQuote`,
 * a thin pure wrapper around `quoteRefund` (lib/payments/refund-policy.ts). The
 * figure shown here is never reimplemented; it is the canonical math.
 *
 * Hydration safety: every piece of state initialises to an empty/stable string
 * (no `new Date()` / `Date.now()` at render time), so the server and the client
 * first paint are byte-identical. Time-derived numbers are computed only from
 * user-entered values, after mount, inside a render `useMemo`.
 */

type PresetOption = { value: CalculablePreset; labelKey: 'presetFlexible' | 'presetModerate' | 'presetStrict' }

const PRESET_OPTIONS: readonly PresetOption[] = [
  { value: 'flexible', labelKey: 'presetFlexible' },
  { value: 'moderate', labelKey: 'presetModerate' },
  { value: 'strict', labelKey: 'presetStrict' },
]

/** Slab → DESIGN.md semantic-status tokens (color WITH icon, never color alone). */
const SLAB_STYLE = {
  free_window: {
    tint: 'border-success/30 bg-success-subtle text-success',
    icon: CheckCircle2,
    labelKey: 'slabFree' as const,
  },
  '50%_window': {
    tint: 'border-warning/30 bg-warning-subtle text-warning',
    icon: Clock,
    labelKey: 'slabHalf' as const,
  },
  no_refund_window: {
    tint: 'border-destructive/30 bg-destructive/10 text-destructive',
    icon: CircleSlash,
    labelKey: 'slabNone' as const,
  },
  // The outside-policy case (cancel at/after start) is rendered by its own
  // block (calc-outside) with the dispute notice, not via the slab indicator,
  // so it intentionally has no SLAB_STYLE entry. TriangleAlert is used there.
} as const

function formatInr(rupees: number): string {
  return `₹${rupees.toLocaleString('en-IN')}`
}

export function RefundCalculatorIsland() {
  const t = useTranslations('CancellationPolicyPage.calculator')

  // All inputs start empty → identical server/client first render (no hydration
  // mismatch). The user supplies every value; nothing is seeded from `now`.
  const [amount, setAmount] = useState('')
  const [preset, setPreset] = useState<CalculablePreset>('flexible')
  const [startAt, setStartAt] = useState('')
  const [cancelAt, setCancelAt] = useState('')

  const amountId = useId()
  const presetId = useId()
  const startId = useId()
  const cancelId = useId()

  const quote = useMemo(() => {
    const rupees = Number(amount)
    if (!amount || !Number.isFinite(rupees) || rupees <= 0) return null
    if (!startAt || !cancelAt) return null

    const startMs = new Date(startAt).getTime()
    const cancelMs = new Date(cancelAt).getTime()
    if (!Number.isFinite(startMs) || !Number.isFinite(cancelMs)) return null

    // Cancellation on or after start is outside-policy (ADR-0003 → Dispute).
    // Surface it honestly rather than computing a refund.
    if (cancelMs >= startMs) {
      return { basis: 'outside_policy' as const, refundAmountRupees: 0, cancellationFeeRupees: Math.floor(rupees) }
    }

    const hoursBefore = (startMs - cancelMs) / 3_600_000
    return computeRefundQuote({
      preset,
      bookingTotalRupees: Math.floor(rupees),
      hoursBefore,
    })
  }, [amount, preset, startAt, cancelAt])

  const slab = quote ? SLAB_STYLE[quote.basis as keyof typeof SLAB_STYLE] : null
  const SlabIcon = slab?.icon

  return (
    <section
      aria-labelledby={`${presetId}-calc-heading`}
      className="mb-12 rounded-[var(--radius-card)] border border-border bg-surface-1 p-5 shadow-[var(--shadow-md)] sm:p-7"
      data-testid="refund-calculator"
    >
      <p className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-primary-strong">
        {t('eyebrow')}
      </p>
      <h2
        id={`${presetId}-calc-heading`}
        className="mt-1 font-[family-name:var(--font-heading)] text-h2 font-semibold text-foreground"
      >
        {t('heading')}
      </h2>
      <p className="mt-2 max-w-[60ch] text-sm text-muted-foreground">
        {t('description')}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={amountId} className="text-xs font-medium text-foreground">
            {t('amountLabel')}
          </label>
          <input
            id={amountId}
            data-testid="calc-amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('amountPlaceholder')}
            className="h-10 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm tabular-nums text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={presetId} className="text-xs font-medium text-foreground">
            {t('presetLabel')}
          </label>
          <select
            id={presetId}
            data-testid="calc-preset"
            value={preset}
            onChange={(e) => setPreset(e.target.value as CalculablePreset)}
            className="h-10 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {PRESET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={startId} className="text-xs font-medium text-foreground">
            {t('startLabel')}
          </label>
          <input
            id={startId}
            data-testid="calc-start"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="h-10 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </div>

        <div className="flex flex-col gap-[var(--space-field)]">
          <label htmlFor={cancelId} className="text-xs font-medium text-foreground">
            {t('cancelLabel')}
          </label>
          <input
            id={cancelId}
            data-testid="calc-cancel"
            type="datetime-local"
            value={cancelAt}
            onChange={(e) => setCancelAt(e.target.value)}
            className="h-10 rounded-[var(--radius-control)] border border-input bg-surface-0 px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Result region — one feedback vocabulary at a time (prompt | result). */}
      <div className="mt-6" aria-live="polite">
        {!quote && (
          <p
            className="rounded-[var(--radius-md)] border border-border bg-surface-2 px-4 py-3 text-sm text-muted-foreground"
            data-testid="calc-prompt"
          >
            {t('promptEmpty')}
          </p>
        )}

        {quote && quote.basis === 'outside_policy' && (
          <div
            className="flex items-start gap-3 rounded-[var(--radius-md)] border border-destructive/30 bg-destructive/10 px-4 py-3"
            role="alert"
            data-testid="calc-outside"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <p className="text-sm text-destructive">{t('promptInvalid')}</p>
          </div>
        )}

        {quote && quote.basis !== 'outside_policy' && slab && SlabIcon && (
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div
              className={`flex items-center gap-3 rounded-[var(--radius-md)] border px-4 py-3 ${slab.tint}`}
              data-testid="calc-slab"
              data-basis={quote.basis}
            >
              <SlabIcon className="size-5 shrink-0" aria-hidden />
              <span className="text-sm font-medium">{t(slab.labelKey)}</span>
            </div>
            <div className="text-right">
              <p className="text-2xs uppercase tracking-[var(--tracking-eyebrow)] text-muted-foreground">
                {t('resultLabel')}
              </p>
              <p
                className="font-[family-name:var(--font-heading)] text-h1 font-bold tabular-nums text-primary-strong"
                data-testid="calc-refund"
              >
                {formatInr(quote.refundAmountRupees)}
              </p>
              {quote.cancellationFeeRupees > 0 && (
                <p className="text-xs tabular-nums text-muted-foreground">
                  {t('feeLabel')}: {formatInr(quote.cancellationFeeRupees)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Two-bucket Wallet note — where the refund lands (Refund balance). */}
      <div className="mt-6 flex items-start gap-3 rounded-[var(--radius-md)] border border-success/30 bg-success-subtle px-4 py-3">
        <Wallet className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div>
          <p className="text-sm font-medium text-foreground">{t('walletNoteHeading')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('walletNoteBody')}</p>
        </div>
      </div>
    </section>
  )
}
