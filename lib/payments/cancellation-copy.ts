/**
 * Canonical, single-source plain-language cancellation copy (ADR-0005 wedge).
 *
 * "Plain-language policy renders identically everywhere — sourced from ONE
 * constant per preset." This module IS that one constant. Both the vendor
 * Add/Edit form (hardcoded English) and the customer Experience detail (via
 * next-intl, numeric figure interpolated) read the same source so the rendered
 * policy can never diverge across surfaces.
 *
 * Crucially, every hour/day figure here DERIVES from `PRESET_WINDOWS` in
 * refund-policy.ts (the refund-math source of truth). A vendor still cannot
 * type a bespoke refund number — there are exactly four named, constant-driven
 * presets; this is the "policy as content" transparency wedge.
 *
 * Pure, no I/O, unit-tested.
 */

import { PRESET_WINDOWS } from './refund-policy'

/**
 * The four presets a Vendor can pick in the form's radio set (ADR-0005 revision
 * 2026-06-16). `custom` is admin-gated and deliberately ABSENT here — it has no
 * constant-driven plain-language line (its text is stored per-Experience).
 */
export type CancellationCopyPreset = 'flexible' | 'moderate' | 'strict' | 'non_cancellable'

const HOURS_PER_DAY = 24

/** Whole days for an hour figure that is a clean multiple of 24, else null. */
function wholeDays(hours: number): number | null {
  return hours % HOURS_PER_DAY === 0 ? hours / HOURS_PER_DAY : null
}

/**
 * The free-cancellation window in HOURS for a preset, derived from
 * `PRESET_WINDOWS`. `non_cancellable` (and any unknown preset) has no free
 * window → null.
 */
export function cancellationFreeHours(preset: string): number | null {
  if (preset === 'flexible' || preset === 'moderate' || preset === 'strict') {
    return PRESET_WINDOWS[preset].freeHours
  }
  return null
}

/** True only for the `non_cancellable` preset; any other/legacy value is cancellable. */
export function isNonCancellable(preset: string): boolean {
  return preset === 'non_cancellable'
}

/**
 * The customer "Free cancellation up to Xh before activity" line input: the
 * derived hour figure for a windowed preset, or null when there is no free
 * window (non_cancellable / unknown) — in which case the caller shows the
 * "Non-cancellable" badge instead.
 */
export function freeCancellationLine(preset: string): { hours: number } | null {
  const hours = cancellationFreeHours(preset)
  return hours === null ? null : { hours }
}

interface CancellationCopyEntry {
  /**
   * The plain-language rule, English, shown verbatim on the VENDOR form so the
   * Vendor sees exactly what each preset means. Figures derive from
   * `PRESET_WINDOWS` at module load — they cannot drift from the refund math.
   * The CUSTOMER detail does NOT use this string; it renders an i18n key with
   * the same derived figure interpolated.
   */
  rule: string
}

/** flexible: 24h free / 2h 50% (PRESET_WINDOWS.flexible). */
function flexibleRule(): string {
  const free = PRESET_WINDOWS.flexible.freeHours
  const half = PRESET_WINDOWS.flexible.halfHours
  return `Free cancellation up to ${free}h before the activity. 50% refund up to ${half}h before. No refund after.`
}

/** moderate: 72h (= 3 days) free / 24h 50%. Fixes the legacy "7 days" copy bug. */
function moderateRule(): string {
  const free = PRESET_WINDOWS.moderate.freeHours
  const half = PRESET_WINDOWS.moderate.halfHours
  const freeDays = wholeDays(free)
  const window = freeDays !== null ? `${free}h (${freeDays} days)` : `${free}h`
  return `Free cancellation up to ${window} before the activity. 50% refund up to ${half}h before. No refund after.`
}

/** strict: 14 days free / 7 days 50%. */
function strictRule(): string {
  const freeDays = wholeDays(PRESET_WINDOWS.strict.freeHours)
  const halfDays = wholeDays(PRESET_WINDOWS.strict.halfHours)
  return `Free cancellation up to ${freeDays} days before the activity. 50% refund up to ${halfDays} days before. No refund after.`
}

/**
 * The single per-preset plain-language source. Built once from `PRESET_WINDOWS`
 * at module load.
 */
export const CANCELLATION_COPY: Record<CancellationCopyPreset, CancellationCopyEntry> = {
  flexible: { rule: flexibleRule() },
  moderate: { rule: moderateRule() },
  strict: { rule: strictRule() },
  non_cancellable: {
    rule: 'Non-cancellable — no refund after payment.',
  },
}
