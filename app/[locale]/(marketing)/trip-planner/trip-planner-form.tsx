'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TRAVEL_STYLES } from '@/lib/ai/trip-planner-constants'

import { planTrip, type PlanTripResult } from './actions'
import { ItineraryResult } from './itinerary-result'

interface Option {
  slug: string
  label: string
}

interface TripPlannerFormProps {
  regions: Option[]
  activities: Option[]
}

export function TripPlannerForm({ regions, activities }: TripPlannerFormProps) {
  const t = useTranslations('TripPlannerPage')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<PlanTripResult | null>(null)

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      // planTrip is a Server Action — it executes on the server, where the
      // Anthropic key lives. Nothing secret crosses this boundary.
      const res = await planTrip(formData)
      setResult(res)
    })
  }

  return (
    <div className="space-y-8">
      <form
        action={onSubmit}
        className="grid gap-5 rounded-[var(--radius-card)] border bg-card p-6 shadow-[var(--shadow-sm)] md:grid-cols-2"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-region">{t('form.region')}</Label>
          <select
            id="tp-region"
            name="region"
            required
            defaultValue=""
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="" disabled>
              {t('form.regionPlaceholder')}
            </option>
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-activity">{t('form.activity')}</Label>
          <select
            id="tp-activity"
            name="activity"
            defaultValue=""
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <option value="">{t('form.anyActivity')}</option>
            {activities.map((a) => (
              <option key={a.slug} value={a.slug}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-days">{t('form.days')}</Label>
          <Input
            id="tp-days"
            name="days"
            type="number"
            min={1}
            max={7}
            defaultValue={3}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-budget">{t('form.budget')}</Label>
          <Input
            id="tp-budget"
            name="budgetRupees"
            type="number"
            min={0}
            step={500}
            placeholder={t('form.budgetPlaceholder')}
            defaultValue={15000}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-group">{t('form.groupSize')}</Label>
          <Input
            id="tp-group"
            name="groupSize"
            type="number"
            min={1}
            max={40}
            defaultValue={2}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tp-style">{t('form.travelStyle')}</Label>
          <select
            id="tp-style"
            name="travelStyle"
            defaultValue="adventure"
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {TRAVEL_STYLES.map((style) => (
              <option key={style} value={style}>
                {t(`style.${style}`)}
              </option>
            ))}
          </select>
        </div>

        <div className="md:col-span-2">
          <Button type="submit" disabled={isPending} className="w-full md:w-auto">
            <Sparkles aria-hidden="true" />
            {isPending ? t('form.submitting') : t('form.submit')}
          </Button>
        </div>
      </form>

      {isPending && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[var(--radius-card)] border border-dashed p-6 text-center text-sm text-muted-foreground"
        >
          {t('form.submitting')}
        </div>
      )}

      {!isPending && result && !result.ok && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-warning/30 bg-warning-subtle p-6"
        >
          <p className="font-medium text-warning">
            {result.error === 'no_inventory' ? t('empty.title') : t('error.title')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.error === 'no_inventory' ? t('empty.body') : t('error.body')}
          </p>
        </div>
      )}

      {!isPending && result && result.ok && (
        <ItineraryResult itinerary={result.itinerary} />
      )}
    </div>
  )
}
