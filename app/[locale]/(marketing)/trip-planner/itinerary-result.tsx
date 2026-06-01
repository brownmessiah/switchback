'use client'

import Link from 'next/link'

import { useTranslations } from 'next-intl'
import { ArrowRight, Backpack, Sparkles } from 'lucide-react'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import type { Itinerary } from '@/lib/ai/trip-planner'

interface ItineraryResultProps {
  itinerary: Itinerary
}

export function ItineraryResult({ itinerary }: ItineraryResultProps) {
  const t = useTranslations('TripPlannerPage')

  // Open every day with content by default so the itinerary reads top-to-bottom.
  const defaultOpen = itinerary.days
    .filter((d) => d.items.length > 0)
    .map((d) => `day-${d.dayNumber}`)

  return (
    <section aria-label={t('result.packingHeading')} className="space-y-6">
      {/* Visible AI label (ADR-0010). */}
      <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-info/20 bg-info-subtle px-3 py-2 text-sm text-info">
        <Sparkles aria-hidden="true" className="size-4 shrink-0" />
        <span>{t('aiLabel')}</span>
      </div>

      <Accordion multiple defaultValue={defaultOpen} className="w-full">
        {itinerary.days.map((day) => (
          <AccordionItem key={day.dayNumber} value={`day-${day.dayNumber}`}>
            <AccordionTrigger className="text-left">
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="font-heading text-base font-semibold">
                  {t('result.dayHeading', { day: day.dayNumber, title: day.title })}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {t('result.itemCount', { count: day.items.length })}
                </Badge>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {day.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('result.emptyDay')}</p>
              ) : (
                <ul className="space-y-3">
                  {day.items.map((item) => (
                    <li
                      key={item.experienceId}
                      className="rounded-[var(--radius-card)] border bg-card p-4"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/experience/${item.slug}`}
                            className="font-medium text-foreground hover:text-primary-strong"
                          >
                            {item.title}
                          </Link>
                          {item.rationale && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              {item.rationale}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-sm font-medium tabular-nums">
                          {t('result.perPerson', { price: item.pricePerPersonRupees })}
                        </span>
                      </div>
                      <Link
                        href={`/experience/${item.slug}`}
                        className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline"
                      >
                        {t('result.viewExperience')}
                        <ArrowRight aria-hidden="true" className="size-3.5" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Packing list */}
      {itinerary.packingList.length > 0 && (
        <div className="rounded-[var(--radius-card)] border bg-muted/40 p-5">
          <h3 className="mb-3 flex items-center gap-2 font-heading text-base font-semibold">
            <Backpack aria-hidden="true" className="size-4" />
            {t('result.packingHeading')}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {itinerary.packingList.map((entry) => (
              <li key={entry} className="flex items-center gap-2 text-sm">
                <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {entry}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('result.disclaimer')}</p>
    </section>
  )
}
