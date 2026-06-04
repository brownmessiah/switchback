'use client'

import type { ReactElement } from 'react'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'
import { formatSlotTime, type CalendarSlot } from '@/lib/experiences/booking-calendar'

interface TimeSlotListProps {
  /** The slots on the selected date (ascending). */
  slots: CalendarSlot[]
  /** The chosen slot id. */
  selectedSlotId: string | null
  /** Called with the picked slot id. */
  onSelectSlot: (slotId: string) => void
  /** Active locale for the time label. */
  locale: string
}

/**
 * Time-slot picker for the selected calendar date (#70). Each slot shows its
 * time range + remaining seats ("max attendees"); a sold-out slot is disabled.
 * Picking one sets the booking slot; the rail then bounds the participant
 * stepper to that slot's remaining seats.
 */
export function TimeSlotList({
  slots,
  selectedSlotId,
  onSelectSlot,
  locale,
}: TimeSlotListProps): ReactElement | null {
  const t = useTranslations('ExperiencePage')
  if (slots.length === 0) return null

  return (
    <div data-testid="time-slot-list" className="space-y-2">
      <p className="text-xs font-medium text-foreground">{t('calendar.times')}</p>
      <div className="flex flex-wrap gap-2">
        {slots.map((s) => {
          const soldOut = s.remaining <= 0
          const selected = s.id === selectedSlotId
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`time-slot-${s.id}`}
              disabled={soldOut}
              aria-pressed={soldOut ? undefined : selected}
              onClick={() => !soldOut && onSelectSlot(s.id)}
              className={cn(
                'flex flex-col items-start rounded-[var(--radius-control)] border px-3 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                soldOut && 'cursor-not-allowed border-border text-muted-foreground/50',
                !soldOut && !selected && 'border-border hover:border-primary/60 hover:bg-muted',
                selected && 'border-primary bg-primary/10 text-foreground',
              )}
            >
              <span className="text-sm font-medium tabular-nums">
                {formatSlotTime(s.startAtISO, s.endAtISO, locale)}
              </span>
              <span className="text-2xs text-muted-foreground">
                {soldOut ? t('calendar.soldOut') : t('calendar.seatsLeft', { count: s.remaining })}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
