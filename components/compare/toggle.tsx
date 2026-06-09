'use client'

import { useTranslations } from 'next-intl'

import { useCompareSelection } from '@/components/compare/use-compare-selection'
import { emitCompareChange } from '@/lib/compare/events'
import { COMPARE_MAX, toggleCompare } from '@/lib/compare/storage'

interface CompareToggleProps {
  /** Canonical slug of the Experience this card represents. */
  slug: string
  className?: string
}

/**
 * "Compare" toggle for an Experience card (DECISION D10).
 *
 * A guest-friendly checkbox that adds / removes the card's slug from the
 * compare selection (localStorage, max 3). It is purely additive to the card —
 * the card's existing trust badges / highlight / wishlist heart are untouched.
 *
 * When 3 OTHER listings are already selected and this one is not, the checkbox
 * is disabled (the cap is honoured at the UI so the visitor gets a clear signal
 * rather than a silent no-op). A selected listing is never disabled, so it can
 * always be removed. Toggling broadcasts a same-page event so the global tray
 * updates instantly. min-h tap target for mobile (ADR-0018).
 */
export function CompareToggle({ slug, className }: CompareToggleProps) {
  const t = useTranslations('Compare')
  const { slugs } = useCompareSelection()

  const checked = slugs.includes(slug)
  const atCap = slugs.length >= COMPARE_MAX
  const disabled = atCap && !checked

  function handleChange() {
    toggleCompare(slug)
    emitCompareChange()
  }

  return (
    <label
      className={
        'min-tap inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground select-none has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50' +
        (className ? ` ${className}` : '')
      }
      title={disabled ? t('toggle.capReached', { max: COMPARE_MAX }) : undefined}
    >
      <input
        type="checkbox"
        data-testid="compare-toggle"
        className="size-4 rounded border-border accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={handleChange}
        aria-label={t('toggle.label')}
      />
      <span>{t('toggle.label')}</span>
    </label>
  )
}
