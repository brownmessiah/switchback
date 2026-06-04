'use client'

import { useState, type ReactElement } from 'react'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  dateIsBookable,
  dateKey,
  monthCells,
  slotsByDate,
  type CalendarSlot,
} from '@/lib/experiences/booking-calendar'

export interface BookingCalendarLabels {
  selectDate: string
  today: string
  unavailable: string
  selected: string
  prevMonth: string
  nextMonth: string
  noDates: string
}

interface BookingCalendarProps {
  /** Future, ascending-sorted bookable slots (a date may have several). */
  slots: CalendarSlot[]
  /** The currently chosen date key (`YYYY-MM-DD`). */
  selectedDate: string | null
  /** Called with the picked date key — the rail then shows that date's times. */
  onSelectDate: (dateKey: string) => void
  /** Active locale — month + weekday names are formatted via Intl. */
  locale: string
  /** Already-translated UI labels. */
  labels: BookingCalendarLabels
}

function ym(d: Date): { year: number; month: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}

/**
 * Month-grid DATE picker for the Booking rail (#70). A date is selectable when
 * it has at least one slot with seats remaining; picking it surfaces that date's
 * time slots in the rail. Month + weekday names are localized via Intl (UTC).
 */
export function BookingCalendar({
  slots,
  selectedDate,
  onSelectDate,
  locale,
  labels,
}: BookingCalendarProps): ReactElement {
  const firstSlotDate = slots.length ? new Date(slots[0].startAtISO) : new Date()
  const [view, setView] = useState(() => ym(firstSlotDate))

  if (slots.length === 0) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        {labels.noDates}
      </div>
    )
  }

  const byDate = slotsByDate(slots)
  const todayKey = dateKey(new Date())
  const nowYm = ym(new Date())
  const atCurrentMonth = view.year === nowYm.year && view.month === nowYm.month

  const cells = monthCells(view.year, view.month)
  const monthLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(view.year, view.month, 1)))
  const weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    weekdayFmt.format(new Date(Date.UTC(2023, 0, 1 + i))),
  )
  const dayFmt = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

  function shiftMonth(delta: number): void {
    setView((v) => ym(new Date(Date.UTC(v.year, v.month + delta, 1))))
  }

  const navBtn =
    'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <div data-testid="booking-calendar" className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        {labels.selectDate}
      </p>
      <div className="rounded-[var(--radius-md)] border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            aria-label={labels.prevMonth}
            disabled={atCurrentMonth}
            onClick={() => shiftMonth(-1)}
            className={navBtn}
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="text-sm font-medium" aria-live="polite">
            {monthLabel}
          </span>
          <button
            type="button"
            aria-label={labels.nextMonth}
            onClick={() => shiftMonth(1)}
            className={navBtn}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {weekdays.map((w, i) => (
            <div
              key={`wd-${i}`}
              className="py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {w}
            </div>
          ))}
          {cells.map((cell, i) => {
            if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />
            const key = dateKey(cell)
            const available = dateIsBookable(byDate.get(key))
            const isSelected = key === selectedDate
            const isToday = key === todayKey
            return (
              <button
                key={key}
                type="button"
                data-testid={`cal-day-${key}`}
                disabled={!available}
                aria-pressed={available ? isSelected : undefined}
                aria-label={`${dayFmt.format(cell)}${available ? '' : ` — ${labels.unavailable}`}`}
                onClick={() => available && onSelectDate(key)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !available && 'cursor-not-allowed text-muted-foreground/40',
                  available && !isSelected && 'font-medium text-foreground hover:bg-muted',
                  isSelected && 'bg-primary font-semibold text-primary-foreground',
                  isToday && !isSelected && 'ring-1 ring-primary',
                )}
              >
                {cell.getUTCDate()}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="size-2 rounded-full ring-1 ring-primary" />
            {labels.today}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="size-2 rounded-full bg-primary" />
            {labels.selected}
          </span>
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="size-2 rounded-full bg-muted" />
            {labels.unavailable}
          </span>
        </div>
      </div>
    </div>
  )
}
