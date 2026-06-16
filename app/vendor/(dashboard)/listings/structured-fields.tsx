'use client'

import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { KNOWN_GUIDE_LANGUAGES } from '@/lib/experiences/structured-schema'

// ── Structured Experience authoring editors (ADR-0017, issue 05) ─────────────
//
// Hardcoded English to match the surrounding stepper convention — the vendor
// dashboard lives OUTSIDE app/[locale], is an internal noindex surface, and is
// NOT next-intl-wired (see the form-stepper). These editors are extracted into
// their own file so the create/edit stepper diff stays small and additive, and
// so the array + itinerary editors are unit-testable in isolation.

export const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'challenging', label: 'Challenging' },
  { value: 'extreme', label: 'Extreme' },
] as const

export type DifficultyValue = (typeof DIFFICULTY_OPTIONS)[number]['value']

// Full guide-language names keyed by the ADR-0013 locale codes.
export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  mr: 'Marathi',
  bn: 'Bengali',
  as: 'Assamese',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  pa: 'Punjabi',
  te: 'Telugu',
  ur: 'Urdu',
}

export const MONTHS = [
  { value: 1, label: 'Jan' },
  { value: 2, label: 'Feb' },
  { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' },
  { value: 5, label: 'May' },
  { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' },
  { value: 8, label: 'Aug' },
  { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' },
  { value: 11, label: 'Nov' },
  { value: 12, label: 'Dec' },
] as const

/** A single itinerary step shaped to the shared ItineraryStepInput (ADR-0017). */
export interface StructuredItineraryStep {
  title: string
  description?: string | null
  dayOffset?: number | null
  durationMinutes?: number | null
}

// ── Reusable repeatable text-row editor ──────────────────────────────────────

interface StringListEditorProps {
  label: string
  values: string[]
  onChange: (next: string[]) => void
  max: number
  placeholder?: string
}

/**
 * Repeatable single-line text rows with add/remove, capped at `max`. Used for
 * highlights (≤6) / inclusions / exclusions / what-to-bring (≤15). Empty rows
 * are filtered out by the stepper before submit; the per-item length bound
 * (≤120) is enforced server-side by the shared Zod schema.
 */
export function StringListEditor({
  label,
  values,
  onChange,
  max,
  placeholder,
}: StringListEditorProps) {
  const singular = label.replace(/s$/, '').toLowerCase()

  function addRow() {
    if (values.length >= max) return
    onChange([...values, ''])
  }

  function removeRow(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function editRow(index: number, value: string) {
    onChange(values.map((v, i) => (i === index ? value : v)))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {values.length} / {max}
        </span>
      </div>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={index} data-testid="string-list-row" className="flex items-center gap-2">
            <Input
              value={value}
              maxLength={120}
              placeholder={placeholder}
              onChange={(e) => editRow(index, e.target.value)}
              aria-label={`${singular} ${index + 1}`}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeRow(index)}
              aria-label={`Remove ${singular} ${index + 1}`}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={values.length >= max}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add {singular}
      </Button>
    </div>
  )
}

// ── Repeatable itinerary-step editor ─────────────────────────────────────────

const MAX_ITINERARY_STEPS = 30

interface ItineraryEditorProps {
  steps: StructuredItineraryStep[]
  onChange: (next: StructuredItineraryStep[]) => void
}

/**
 * Repeatable itinerary-step rows (title / description / dayOffset /
 * durationMinutes) with add / remove / reorder-by-index, capped at 30 steps
 * (the shared Zod bound). stepOrder is assigned by array index on persist
 * (replaceItinerary), so the array order here IS the saved order.
 */
export function ItineraryEditor({ steps, onChange }: ItineraryEditorProps) {
  function addStep() {
    if (steps.length >= MAX_ITINERARY_STEPS) return
    onChange([...steps, { title: '', description: '', dayOffset: null, durationMinutes: null }])
  }

  function removeStep(index: number) {
    onChange(steps.filter((_, i) => i !== index))
  }

  function patchStep(index: number, patch: Partial<StructuredItineraryStep>) {
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const next = [...steps]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    onChange(next)
  }

  function parseIntOrNull(value: string): number | null {
    if (value.trim() === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label>Itinerary steps</Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {steps.length} / {MAX_ITINERARY_STEPS}
        </span>
      </div>

      {steps.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No steps yet. Add the flow of the experience (briefing → activity → debrief).
        </p>
      )}

      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li
            key={index}
            data-testid="itinerary-step"
            className="space-y-3 rounded-[var(--radius-card)] border bg-surface-2 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                Step {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move up step ${index + 1}`}
                >
                  <ChevronUp aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => move(index, 1)}
                  disabled={index === steps.length - 1}
                  aria-label={`Move down step ${index + 1}`}
                >
                  <ChevronDown aria-hidden="true" className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeStep(index)}
                  aria-label={`Remove step ${index + 1}`}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`itinerary-title-${index}`}>Step title</Label>
              <Input
                id={`itinerary-title-${index}`}
                value={step.title}
                maxLength={120}
                placeholder="e.g. Safety briefing"
                onChange={(e) => patchStep(index, { title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`itinerary-desc-${index}`}>Description</Label>
              <Textarea
                id={`itinerary-desc-${index}`}
                value={step.description ?? ''}
                maxLength={600}
                rows={2}
                placeholder="What happens in this step…"
                onChange={(e) => patchStep(index, { description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`itinerary-day-${index}`}>Day (0 = same day)</Label>
                <Input
                  id={`itinerary-day-${index}`}
                  type="number"
                  min={0}
                  className="tabular-nums"
                  value={step.dayOffset ?? ''}
                  onChange={(e) => patchStep(index, { dayOffset: parseIntOrNull(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`itinerary-dur-${index}`}>Duration (min)</Label>
                <Input
                  id={`itinerary-dur-${index}`}
                  type="number"
                  min={1}
                  className="tabular-nums"
                  value={step.durationMinutes ?? ''}
                  onChange={(e) =>
                    patchStep(index, { durationMinutes: parseIntOrNull(e.target.value) })
                  }
                />
              </div>
            </div>
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addStep}
        disabled={steps.length >= MAX_ITINERARY_STEPS}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add step
      </Button>
    </div>
  )
}

// ── Repeatable pricing-variation editor (issue #08) ──────────────────────────

const MAX_PRICING_VARIATIONS = 20

/** A single editable pricing variation row, mirroring `ListingFormValues`. */
export interface PricingVariationRow {
  /** Existing-row id (edit). Absent on a freshly-added row. */
  id?: string
  name: string
  description: string
  /** Raw input string; coerced server-side. numeric(12,2). */
  pricePerPerson: string
  /** Raw input string; coerced to a number / null on submit. */
  durationMinutes: string
  isActive: boolean
}

interface PricingVariationsEditorProps {
  variations: PricingVariationRow[]
  onChange: (next: PricingVariationRow[]) => void
}

/**
 * Repeatable pricing-variation rows (ADR-0011 revision 2026-06-16, issue #08):
 * a Vendor offers distinct priced options on one Experience ("Sunrise batch",
 * "Private session") alongside the Group-size base price. Each row carries a
 * name, optional description, price per person, optional duration, and an
 * active toggle. Capped at 20 (the shared Zod bound). Empty / unnamed rows are
 * dropped by the submit mapper; the per-field bounds are re-checked server-side.
 *
 * Hardcoded English — the vendor dashboard is an internal noindex surface that
 * is NOT next-intl-wired (same convention as the rest of these editors).
 */
export function PricingVariationsEditor({
  variations,
  onChange,
}: PricingVariationsEditorProps) {
  function addRow() {
    if (variations.length >= MAX_PRICING_VARIATIONS) return
    onChange([
      ...variations,
      { name: '', description: '', pricePerPerson: '', durationMinutes: '', isActive: true },
    ])
  }

  function removeRow(index: number) {
    onChange(variations.filter((_, i) => i !== index))
  }

  function patchRow(index: number, patch: Partial<PricingVariationRow>) {
    onChange(variations.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label>Pricing variations</Label>
          <p className="text-xs text-muted-foreground">
            Optional priced options (e.g. &ldquo;Sunrise batch&rdquo;, &ldquo;With gear
            rental&rdquo;). An active variation can stand in for the base price.
          </p>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {variations.length} / {MAX_PRICING_VARIATIONS}
        </span>
      </div>

      {variations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No variations yet. Add one to offer a distinct priced option on this experience.
        </p>
      )}

      <ol className="space-y-3">
        {variations.map((variation, index) => (
          <li
            key={variation.id ?? index}
            data-testid="pricing-variation-row"
            className="space-y-3 rounded-[var(--radius-card)] border bg-surface-2 p-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium tabular-nums text-muted-foreground">
                Variation {index + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(index)}
                aria-label={`Remove variation ${index + 1}`}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`variation-name-${index}`}>Name</Label>
              <Input
                id={`variation-name-${index}`}
                value={variation.name}
                maxLength={120}
                placeholder="e.g. Sunrise batch"
                onChange={(e) => patchRow(index, { name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`variation-desc-${index}`}>Description (optional)</Label>
              <Textarea
                id={`variation-desc-${index}`}
                value={variation.description}
                maxLength={600}
                rows={2}
                placeholder="What's different about this option…"
                onChange={(e) => patchRow(index, { description: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`variation-price-${index}`}>Price per person (₹)</Label>
                <Input
                  id={`variation-price-${index}`}
                  type="number"
                  min={1}
                  className="tabular-nums"
                  value={variation.pricePerPerson}
                  placeholder="1800"
                  onChange={(e) => patchRow(index, { pricePerPerson: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`variation-duration-${index}`}>Duration (min, optional)</Label>
                <Input
                  id={`variation-duration-${index}`}
                  type="number"
                  min={1}
                  className="tabular-nums"
                  value={variation.durationMinutes}
                  placeholder="90"
                  onChange={(e) => patchRow(index, { durationMinutes: e.target.value })}
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={variation.isActive}
                onChange={(e) => patchRow(index, { isActive: e.target.checked })}
                className="rounded border-input"
              />
              Active (offered to customers)
            </label>
          </li>
        ))}
      </ol>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={variations.length >= MAX_PRICING_VARIATIONS}
      >
        <Plus aria-hidden="true" className="size-4" />
        Add variation
      </Button>
    </div>
  )
}

// ── Multi-select checkbox group (languages, season months) ───────────────────

interface CheckboxGroupProps<T extends string | number> {
  legend: string
  options: readonly { value: T; label: string }[]
  selected: readonly T[]
  onToggle: (value: T) => void
}

export function CheckboxGroup<T extends string | number>({
  legend,
  options,
  selected,
  onToggle,
}: CheckboxGroupProps<T>) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((opt) => (
          <label key={String(opt.value)} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => onToggle(opt.value)}
              className="rounded border-input"
            />
            {opt.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export const LANGUAGE_OPTIONS = KNOWN_GUIDE_LANGUAGES.map((code) => ({
  value: code,
  label: LANGUAGE_LABELS[code] ?? code,
}))
