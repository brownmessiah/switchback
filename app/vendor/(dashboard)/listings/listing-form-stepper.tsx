'use client'

import {
  Check,
  CircleAlert,
  CircleDashed,
  FileText,
  IndianRupee,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  computeListingCompleteness,
  type ListingCompletenessField,
} from '@/lib/vendor/listing-completeness'

// ── Shared option vocabularies (single source for both new + edit) ──────────

export const ACTIVITIES = [
  { value: 'rafting', label: 'Rafting' },
  { value: 'paragliding', label: 'Paragliding' },
  { value: 'trekking', label: 'Trekking' },
  { value: 'scuba', label: 'Scuba diving' },
  { value: 'camping', label: 'Camping' },
  { value: 'kayaking', label: 'Kayaking' },
  { value: 'bungee', label: 'Bungee jumping' },
  { value: 'skiing', label: 'Skiing' },
  { value: 'surfing', label: 'Surfing' },
  { value: 'canyoning', label: 'Canyoning' },
] as const

export const REGIONS = [
  { value: 'rishikesh', label: 'Rishikesh' },
  { value: 'manali', label: 'Manali' },
  { value: 'bir-billing', label: 'Bir Billing' },
  { value: 'goa', label: 'Goa' },
  { value: 'ladakh', label: 'Ladakh' },
  { value: 'sikkim', label: 'Sikkim' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'meghalaya', label: 'Meghalaya' },
  { value: 'andaman', label: 'Andaman' },
  { value: 'coorg', label: 'Coorg' },
] as const

// Only the two SHIPPED payment modes are offered. Reserve-now-pay-later is
// schema-named but unbuilt and must never surface here (ADR-0002 / #112).
export const PAYMENT_MODES = [
  { value: 'full_upfront', label: 'Full upfront' },
  { value: 'partial_pay', label: 'Partial pay' },
] as const

export const PERMITS = [
  'forest_department',
  'wildlife_clearance',
  'district_admin',
  'noc_local_body',
  'adventure_sports_license',
] as const

export type CancellationPreset = 'flexible' | 'moderate' | 'strict' | 'custom'

// The platform's single default commission rate (ADR-0008 /
// PLATFORM_DEFAULT_COMMISSION_RATE = '20.00'). Shown transparently as a trust
// line BEFORE the final step (DESIGN.md B5). A static disclosure, not a
// money-path computation.
export const PLATFORM_COMMISSION_PERCENT = '20%'

// ── Form value contract shared by both routes ───────────────────────────────

export interface ListingFormValues {
  title: string
  shortDescription: string
  longDescription: string
  activity: string
  region: string
  price12: string
  price35: string
  price6: string
  cancellationPreset: CancellationPreset
  paymentModes: string[]
  isCombo: boolean
  requiredPermits: string[]
  requiresSafetyStack: boolean
}

export interface ListingSubmitResult {
  ok: boolean
  error?: string
}

interface ListingFormStepperProps {
  mode: 'create' | 'edit'
  initialValues: ListingFormValues
  /** Persisted save via the real create/edit action. Returns ok/error. */
  onSubmit: (values: ListingFormValues) => Promise<ListingSubmitResult>
  /** Edit-only image manager rendered into the Details section. */
  imageSlot?: ReactNode
  /** Whether the listing already has ≥1 image (edit completeness signal). */
  hasImage?: boolean
  /** localStorage key for create-mode draft persistence. Omit to disable. */
  draftKey?: string
  /** Submit button label on the final/persistent submit control. */
  submitLabel: string
  submitLabelBusy: string
  /** Inline success line shown after a persisted save (edit mode). */
  successText?: string
}

type SectionId = 'details' | 'pricing' | 'policy' | 'review'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'policy', label: 'Policy' },
  { id: 'review', label: 'Review' },
]

// Human labels for the publish-readiness checklist (#75 scorer fields).
const COMPLETENESS_LABELS: Record<ListingCompletenessField, string> = {
  title: 'Title',
  shortDescription: 'Short description',
  longDescription: 'Long description',
  pricePerPerson_1_2: '1-2 guests price',
  pricePerPerson_3_5: '3-5 guests price',
  pricePerPerson_6_plus: '6+ guests price',
  activitySlug: 'Activity',
  regionSlug: 'Region',
  imageCount: 'At least one photo',
}

function isPositive(value: string): boolean {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

export function ListingFormStepper({
  mode,
  initialValues,
  onSubmit,
  imageSlot,
  hasImage = false,
  draftKey,
  submitLabel,
  submitLabelBusy,
  successText,
}: ListingFormStepperProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [sectionError, setSectionError] = useState('')

  const [values, setValues] = useState<ListingFormValues>(initialValues)

  function update<K extends keyof ListingFormValues>(
    key: K,
    value: ListingFormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  // ── Draft persistence (create mode, variant C fold-in) ──────────────────
  // Restored in useEffect (never at render) to avoid a hydration mismatch.
  // The authoritative draft save remains the real create action (status:
  // 'draft'); this is purely a local convenience so an interrupted Vendor
  // doesn't lose typed field state.
  useEffect(() => {
    if (!draftKey) return
    try {
      const raw = window.localStorage.getItem(draftKey)
      if (!raw) return
      const draft = JSON.parse(raw) as Partial<ListingFormValues>
      setValues((prev) => ({ ...prev, ...draft }))
    } catch {
      // Corrupt/blocked storage is non-fatal — start from the initial values.
    }
  }, [draftKey])

  useEffect(() => {
    if (!draftKey) return
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(values))
    } catch {
      // Storage unavailable (private mode / quota) — degrade silently.
    }
  }, [draftKey, values])

  // ── Per-section validation (replaces submit-only) ───────────────────────
  function validateSection(id: SectionId): string | null {
    if (id === 'details') {
      if (!values.title.trim()) return 'Add an experience title to continue.'
      if (!values.activity) return 'Choose an activity to continue.'
      if (!values.region) return 'Choose a region to continue.'
    }
    if (id === 'pricing') {
      if (!isPositive(values.price12)) {
        return 'Enter a positive price for the 1-2 guests bracket.'
      }
      if (values.price35 && !isPositive(values.price35)) {
        return 'The 3-5 guests price must be a positive amount.'
      }
      if (values.price6 && !isPositive(values.price6)) {
        return 'The 6+ guests price must be a positive amount.'
      }
    }
    if (id === 'policy') {
      if (values.paymentModes.length === 0) {
        return 'Select at least one payment mode.'
      }
    }
    return null
  }

  function goNext() {
    const current = SECTIONS[stepIndex]!.id
    const problem = validateSection(current)
    if (problem) {
      setSectionError(problem)
      return
    }
    setSectionError('')
    setStepIndex((i) => Math.min(i + 1, SECTIONS.length - 1))
  }

  function goBack() {
    setSectionError('')
    setStepIndex((i) => Math.max(i - 1, 0))
  }

  function goToStep(i: number) {
    setSectionError('')
    setStepIndex(i)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // In edit mode the persistent submit can fire from any step; validate the
    // whole form's gating fields first so we never POST an empty title/price.
    const blocking =
      validateSection('details') ||
      validateSection('pricing') ||
      validateSection('policy')
    if (blocking) {
      setSectionError(blocking)
      return
    }

    setError('')
    setSectionError('')
    setSuccess(false)
    setLoading(true)
    try {
      const result = await onSubmit(values)
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong. Please try again.')
        return
      }
      // Clear the local draft on a successful persisted save.
      if (draftKey) {
        try {
          window.localStorage.removeItem(draftKey)
        } catch {
          // Non-fatal.
        }
      }
      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Publish-readiness via the shared #75 scorer (no duplicated logic) ────
  const completeness = computeListingCompleteness({
    title: values.title || null,
    shortDescription: values.shortDescription || null,
    longDescription: values.longDescription || null,
    pricePerPerson_1_2: values.price12 || null,
    pricePerPerson_3_5: values.price35 || null,
    pricePerPerson_6_plus: values.price6 || null,
    activitySlug: values.activity || null,
    regionSlug: values.region || null,
    imageCount: hasImage ? 1 : 0,
  })

  const currentSection = SECTIONS[stepIndex]!.id
  const isReview = currentSection === 'review'
  // Edit mode keeps a persistent submit on every step (non-linear editing —
  // a returning Vendor fixing one field shouldn't have to page to Review).
  // Create mode submits only from the Review step.
  const showSubmit = mode === 'edit' || isReview

  function handlePaymentToggle(modeValue: string) {
    update(
      'paymentModes',
      values.paymentModes.includes(modeValue)
        ? values.paymentModes.filter((m) => m !== modeValue)
        : [...values.paymentModes, modeValue],
    )
  }

  function handlePermitToggle(permit: string) {
    update(
      'requiredPermits',
      values.requiredPermits.includes(permit)
        ? values.requiredPermits.filter((p) => p !== permit)
        : [...values.requiredPermits, permit],
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Persistent trust banner: 0% upfront + commission transparency ──
          (DESIGN.md B5). success-subtle tint + paired lucide icon so the
          signal is never carried by color alone (DESIGN.md §1.3 / §5). */}
      <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-success-subtle p-4">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-success">
            0% upfront fee — listing on Outvers is free.
          </p>
          <p className="text-foreground/80">
            Commission is shown before you finish — the platform rate is{' '}
            <span className="font-medium tabular-nums">{PLATFORM_COMMISSION_PERCENT}</span>{' '}
            on confirmed bookings, nothing else.
          </p>
        </div>
      </div>

      {/* ── B5 stepper header: numbered, labelled, revisitable + completion ── */}
      <nav aria-label="Listing builder progress">
        <ol className="flex items-center gap-2">
          {SECTIONS.map((s, i) => {
            const isDone = stepIndex > i
            const isCurrent = stepIndex === i
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => goToStep(i)}
                  className={[
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors',
                    isDone
                      ? 'bg-success text-success-foreground'
                      : isCurrent
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {isDone ? <Check aria-hidden="true" className="size-4" /> : i + 1}
                </button>
                <span
                  className={[
                    'hidden text-sm font-medium sm:inline',
                    isCurrent
                      ? 'text-foreground'
                      : isDone
                        ? 'text-success'
                        : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {s.label}
                </span>
                {i < SECTIONS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={[
                      'ml-1 h-px flex-1',
                      stepIndex > i ? 'bg-success' : 'bg-border',
                    ].join(' ')}
                  />
                )}
              </li>
            )
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground tabular-nums">
          Step {stepIndex + 1} of {SECTIONS.length}
        </p>
      </nav>

      {/* ── Section 1: Details (+ Images in edit mode) ─────────────────────── */}
      {currentSection === 'details' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-[family-name:var(--font-heading)]">
              <FileText aria-hidden="true" className="size-5 text-primary-strong" />
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Experience title</Label>
              <Input
                id="title"
                value={values.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="e.g. White Water Rafting — 16km stretch"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Short description</Label>
              <Textarea
                id="description"
                value={values.shortDescription}
                onChange={(e) => update('shortDescription', e.target.value)}
                placeholder="Brief summary for listing cards..."
                rows={2}
              />
            </div>

            {mode === 'edit' && (
              <div className="space-y-2">
                <Label htmlFor="longDescription">Long description</Label>
                <Textarea
                  id="longDescription"
                  value={values.longDescription}
                  onChange={(e) => update('longDescription', e.target.value)}
                  placeholder="Full details: what's included, difficulty level, itinerary..."
                  rows={6}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Activity</Label>
                <Select value={values.activity} onValueChange={(v) => update('activity', v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select activity" />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITIES.map((a) => (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={values.region} onValueChange={(v) => update('region', v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select region" />
                  </SelectTrigger>
                  <SelectContent>
                    {REGIONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {imageSlot && (
              <div className="space-y-2">
                <Label>Photos</Label>
                {imageSlot}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section 2: Pricing (Group-size brackets, .tabular-nums) ────────── */}
      {currentSection === 'pricing' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-[family-name:var(--font-heading)]">
              <IndianRupee aria-hidden="true" className="size-5 text-primary-strong" />
              Pricing
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Price per person for each Group-size bracket.
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price12">1-2 guests (₹)</Label>
                <Input
                  id="price12"
                  type="number"
                  className="tabular-nums"
                  value={values.price12}
                  onChange={(e) => update('price12', e.target.value)}
                  placeholder="2500"
                  min={1}
                  required
                />
                <p className="text-xs text-muted-foreground">/ person</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="price35">3-5 guests (₹)</Label>
                <Input
                  id="price35"
                  type="number"
                  className="tabular-nums"
                  value={values.price35}
                  onChange={(e) => update('price35', e.target.value)}
                  placeholder="2000"
                  min={1}
                />
                <p className="text-xs text-muted-foreground">/ person</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="price6">6+ guests (₹)</Label>
                <Input
                  id="price6"
                  type="number"
                  className="tabular-nums"
                  value={values.price6}
                  onChange={(e) => update('price6', e.target.value)}
                  placeholder="1500"
                  min={1}
                />
                <p className="text-xs text-muted-foreground">/ person</p>
              </div>
            </div>
            {mode === 'create' && (
              <p className="text-xs text-muted-foreground">
                If left blank, 3-5 and 6+ prices default to the 1-2 price.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section 3: Policy & settings (cancellation, payment, permits) ──── */}
      {currentSection === 'policy' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-[family-name:var(--font-heading)]">
              <ShieldCheck aria-hidden="true" className="size-5 text-primary-strong" />
              Policy &amp; settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Cancellation policy</Label>
              <Select
                value={values.cancellationPreset}
                onValueChange={(v) =>
                  update('cancellationPreset', (v ?? 'flexible') as CancellationPreset)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="flexible">
                    Flexible — free cancellation up to 24h before
                  </SelectItem>
                  <SelectItem value="moderate">
                    Moderate — free cancellation up to 7 days before
                  </SelectItem>
                  <SelectItem value="strict">
                    Strict — 50% refund up to 7 days before
                  </SelectItem>
                  {mode === 'edit' && (
                    <SelectItem value="custom">Custom — requires admin approval</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Payment modes</p>
              <div className="space-y-2">
                {PAYMENT_MODES.map((m) => (
                  <label key={m.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={values.paymentModes.includes(m.value)}
                      onChange={() => handlePaymentToggle(m.value)}
                      className="rounded border-input"
                    />
                    {m.label}
                  </label>
                ))}
              </div>
            </div>

            {mode === 'edit' && (
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.isCombo}
                    onChange={(e) => update('isCombo', e.target.checked)}
                    className="rounded border-input"
                  />
                  Combo experience (bundles multiple activities)
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={values.requiresSafetyStack}
                    onChange={(e) => update('requiresSafetyStack', e.target.checked)}
                    className="rounded border-input"
                  />
                  Requires safety stack
                </label>

                <div className="space-y-2">
                  <Label>Required permits</Label>
                  <div className="space-y-2">
                    {PERMITS.map((permit) => (
                      <label key={permit} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={values.requiredPermits.includes(permit)}
                          onChange={() => handlePermitToggle(permit)}
                          className="rounded border-input"
                        />
                        {permit.replace(/_/g, ' ')}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Section 4: Review — commission + publish-readiness checklist ───── */}
      {currentSection === 'review' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-[family-name:var(--font-heading)]">
              <Sparkles aria-hidden="true" className="size-5 text-primary-strong" />
              Review &amp; publish
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Commission shown before the final action (DESIGN.md B5). */}
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] bg-info-subtle p-4">
              <IndianRupee aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-info" />
              <div className="text-sm">
                <p className="font-medium text-info">
                  Platform commission:{' '}
                  <span className="tabular-nums">{PLATFORM_COMMISSION_PERCENT}</span> on confirmed
                  bookings
                </p>
                <p className="text-foreground/80">
                  You keep the rest. No upfront or listing fees.
                </p>
              </div>
            </div>

            {/* Publish-readiness checklist (#75 scorer reused, not duplicated). */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Publish readiness</p>
                <span className="text-sm font-medium tabular-nums text-muted-foreground">
                  {completeness.filled}/{completeness.total} ({completeness.percent}%)
                </span>
              </div>
              <ul className="space-y-1.5">
                {Object.entries(COMPLETENESS_LABELS).map(([field, label]) => {
                  const missing = completeness.missing.includes(
                    field as ListingCompletenessField,
                  )
                  return (
                    <li key={field} className="flex items-center gap-2 text-sm">
                      {missing ? (
                        <CircleDashed
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <Check aria-hidden="true" className="size-4 shrink-0 text-success" />
                      )}
                      <span className={missing ? 'text-muted-foreground' : 'text-foreground'}>
                        {label}
                      </span>
                      <span className="sr-only">{missing ? 'missing' : 'complete'}</span>
                    </li>
                  )
                })}
              </ul>
              {completeness.missing.length > 0 && (
                <Alert variant="info">
                  <CircleAlert aria-hidden="true" />
                  <AlertTitle>Not yet publish-ready</AlertTitle>
                  <AlertDescription>
                    You can save now and finish the missing fields later. A fully complete
                    listing is more likely to convert.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Per-section validation error (inline, role=alert) ─────────────── */}
      {sectionError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{sectionError}</AlertDescription>
        </Alert>
      )}

      {/* ── Submit-level status ───────────────────────────────────────────── */}
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && successText && (
        <Alert variant="success">
          <Check aria-hidden="true" />
          <AlertDescription>{successText}</AlertDescription>
        </Alert>
      )}

      {/* ── Sticky footer: Back / Save draft / Continue / Submit ──────────── */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border bg-surface-2 p-4 shadow-[var(--shadow-lg)]">
        {stepIndex > 0 && (
          <Button type="button" variant="outline" onClick={goBack}>
            Back
          </Button>
        )}

        <div className="ml-auto flex items-center gap-3">
          {/* Save-draft: the create action persists with status:'draft', so an
              ordinary submit IS the draft save. We surface it explicitly on the
              non-final create steps so a Vendor can save without paging to
              Review. On the Review step the single primary submit ("Create
              listing") is the save — exactly ONE button[type=submit] there. */}
          {mode === 'create' && !isReview && (
            <Button type="submit" variant="outline" disabled={loading}>
              {loading ? 'Saving…' : 'Save draft'}
            </Button>
          )}

          {!isReview && (
            <Button type="button" onClick={goNext}>
              Continue
            </Button>
          )}

          {showSubmit && (
            <Button type="submit" disabled={loading}>
              {loading ? submitLabelBusy : submitLabel}
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}
