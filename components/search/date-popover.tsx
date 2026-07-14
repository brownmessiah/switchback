'use client'

import type { ReactElement } from 'react'
import { useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays } from 'lucide-react'

import { dateKey, monthCells } from '@/lib/experiences/booking-calendar'

/**
 * Hero-search date selector (home-redesign issue 10, ADR-0020 front-end).
 *
 * A @base-ui popover (no Popover primitive existed in components/ui) with
 * quick pills — Today / Tomorrow / Next weekend — plus a 2-month grid built
 * on the existing booking-calendar helpers (monthCells/dateKey, all UTC —
 * matching how slots are stored and how the backend ranges the day).
 * Past days are disabled (the UI half of "reject past dates"; the server's
 * parseDateParam enforces it regardless). "Anytime" clears the selection.
 *
 * All selection logic lives in the exported `DatePanel` so it is directly
 * unit-testable; the popover shell is exercised in e2e.
 */

/** The Today / Tomorrow / Next-Saturday UTC day keys for the quick pills. */
export function quickPillDates(today: Date): {
  today: string
  tomorrow: string
  nextWeekend: string
} {
  const DAY_MS = 24 * 60 * 60 * 1000
  let weekend = new Date(today.getTime() + DAY_MS)
  while (weekend.getUTCDay() !== 6) {
    weekend = new Date(weekend.getTime() + DAY_MS)
  }
  return {
    today: dateKey(today),
    tomorrow: dateKey(new Date(today.getTime() + DAY_MS)),
    nextWeekend: dateKey(weekend),
  }
}

interface DatePanelProps {
  readonly value: string | null
  readonly onSelect: (day: string | null) => void
  /** Injectable for tests; defaults to now. */
  readonly today?: Date
}

const PILL_CLASS =
  'min-tap rounded-[var(--radius-pill)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

export function DatePanel({
  value,
  onSelect,
  today = new Date(),
}: DatePanelProps): ReactElement {
  const t = useTranslations('HomeSearch')
  const locale = useLocale()
  const pills = quickPillDates(today)
  const todayKey = dateKey(today)

  const monthName = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const weekdayName = new Intl.DateTimeFormat(locale, {
    weekday: 'narrow',
    timeZone: 'UTC',
  })
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeZone: 'UTC',
  })
  // Sunday-start weekday headers (monthCells aligns to Sunday).
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayName.format(new Date(Date.UTC(2026, 2, 1 + i))), // 2026-03-01 is a Sunday
  )

  const months = [0, 1].map((offset) => {
    const base = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1),
    )
    return {
      label: monthName.format(base),
      cells: monthCells(base.getUTCFullYear(), base.getUTCMonth()),
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value === null ? 'true' : 'false'}
          className={`${PILL_CLASS} ${value === null ? 'border-primary bg-primary/10' : ''}`}
          onClick={() => onSelect(null)}
        >
          {t('date.anytime')}
        </button>
        <button
          type="button"
          aria-pressed={value === pills.today ? 'true' : 'false'}
          className={`${PILL_CLASS} ${value === pills.today ? 'border-primary bg-primary/10' : ''}`}
          onClick={() => onSelect(pills.today)}
        >
          {t('date.today')}
        </button>
        <button
          type="button"
          aria-pressed={value === pills.tomorrow ? 'true' : 'false'}
          className={`${PILL_CLASS} ${value === pills.tomorrow ? 'border-primary bg-primary/10' : ''}`}
          onClick={() => onSelect(pills.tomorrow)}
        >
          {t('date.tomorrow')}
        </button>
        <button
          type="button"
          aria-pressed={value === pills.nextWeekend ? 'true' : 'false'}
          className={`${PILL_CLASS} ${value === pills.nextWeekend ? 'border-primary bg-primary/10' : ''}`}
          onClick={() => onSelect(pills.nextWeekend)}
        >
          {t('date.nextWeekend')}
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {months.map(({ label, cells }) => (
          <div key={label} data-testid="date-month">
            <p className="mb-2 text-sm font-semibold">{label}</p>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {weekdays.map((w, i) => (
                <span
                  // Narrow weekday initials repeat (S/S, T/T) — index key.
                  key={`${w}-${i}`}
                  aria-hidden="true"
                  className="text-2xs font-medium text-muted-foreground"
                >
                  {w}
                </span>
              ))}
              {cells.map((cell, i) =>
                cell === null ? (
                  <span key={`pad-${i}`} />
                ) : (
                  <button
                    key={dateKey(cell)}
                    type="button"
                    disabled={dateKey(cell) < todayKey}
                    aria-pressed={value === dateKey(cell) ? 'true' : 'false'}
                    // AT users hear the localized full date; the raw UTC day
                    // key rides on data-day for stable test selectors.
                    aria-label={fullDate.format(cell)}
                    data-day={dateKey(cell)}
                    onClick={() => onSelect(dateKey(cell))}
                    className={`min-tap rounded-[var(--radius-control)] p-1.5 text-sm tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-30 disabled:hover:bg-transparent ${
                      value === dateKey(cell)
                        ? 'bg-primary text-primary-foreground hover:bg-primary'
                        : ''
                    }`}
                  >
                    {cell.getUTCDate()}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface DatePopoverProps {
  readonly value: string | null
  readonly onChange: (day: string | null) => void
}

export function DatePopover({ value, onChange }: DatePopoverProps): ReactElement {
  const t = useTranslations('HomeSearch')
  const locale = useLocale()
  const [open, setOpen] = useState(false)

  const display = value
    ? new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      }).format(new Date(`${value}T00:00:00.000Z`))
    : t('date.anytime')

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-testid="date-popover-trigger"
        aria-label={`${t('fields.date')}: ${display}`}
        className="min-tap flex items-center gap-1.5 whitespace-nowrap rounded-[var(--radius-pill)] px-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CalendarDays aria-hidden="true" className="size-4 shrink-0" />
        {display}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} align="start">
          <Popover.Popup
            data-testid="date-popover"
            aria-label={t('fields.date')}
            className="z-50 max-h-[70vh] w-[min(92vw,34rem)] overflow-y-auto rounded-[var(--radius-card)] border border-border bg-popover p-4 text-popover-foreground shadow-[var(--shadow-lg)] focus-visible:outline-none"
          >
            <DatePanel
              value={value}
              onSelect={(day) => {
                onChange(day)
                setOpen(false)
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
