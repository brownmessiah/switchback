'use client'

import type { ReactElement } from 'react'
import { Minus, Plus } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Reusable participants − / value / + stepper (home-redesign issue 07),
 * extracted from the PDP booking rail so the hero search and the rail share
 * one control. Controlled: the parent owns the count; bounds clamp here
 * (buttons disable at min/max and onChange is never called out of range).
 *
 * `label` feeds the rail-parity aria-labels (`${label} −` / `${label} +`);
 * `valueText` optionally replaces the bare number with a formatted count
 * (the hero shows "2 people", the rail keeps the plain numeral).
 */

interface ParticipantsStepperProps {
  readonly label: string
  readonly value: number
  readonly onChange: (next: number) => void
  readonly min?: number
  readonly max?: number
  readonly disabled?: boolean
  readonly valueText?: string
}

export function ParticipantsStepper({
  label,
  value,
  onChange,
  min = 1,
  max = Number.MAX_SAFE_INTEGER,
  disabled = false,
  valueText,
}: ParticipantsStepperProps): ReactElement {
  // `.min-tap` (Foundation A) raises the hit area to the 44px coarse-pointer
  // floor (DESIGN.md §8.2) on touch, leaving the fine-pointer 36px paint
  // intact — identical recipe to the rail's original inline stepper.
  const stepBtn = buttonVariants({
    variant: 'outline',
    size: 'icon',
    className: 'min-tap size-9 rounded-full',
  })

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}
        aria-label={`${label} −`}
        className={cn(stepBtn, 'disabled:opacity-40')}
      >
        <Minus aria-hidden="true" className="size-4" />
      </button>
      <span
        aria-live="polite"
        className="min-w-7 text-center text-base font-semibold tabular-nums"
      >
        {valueText ?? value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}
        aria-label={`${label} +`}
        className={cn(stepBtn, 'disabled:opacity-40')}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>
    </div>
  )
}
