/**
 * Shared pure functions for i18n translation management scripts.
 *
 * These are extracted so they can be unit-tested without file I/O.
 */

export interface NestedMessages {
  [key: string]: string | NestedMessages
}

/**
 * Flatten a nested message object into a Map of dot-separated keys to values.
 *
 * Example: { HomePage: { hero: { title: "Hi" } } }
 *       -> Map([ ["HomePage.hero.title", "Hi"] ])
 */
export function flattenKeys(obj: NestedMessages, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') {
      result.set(fullKey, value)
    } else {
      for (const [k, v] of flattenKeys(value, fullKey)) {
        result.set(k, v)
      }
    }
  }
  return result
}

/**
 * Return keys present in `sourceKeys` but absent from `targetKeys`.
 */
export function findMissingKeys(
  sourceKeys: ReadonlySet<string>,
  targetKeys: ReadonlySet<string>
): string[] {
  const missing: string[] = []
  for (const key of sourceKeys) {
    if (!targetKeys.has(key)) {
      missing.push(key)
    }
  }
  return missing
}

/**
 * Return keys present in `targetKeys` but absent from `sourceKeys`.
 */
export function findExtraKeys(
  sourceKeys: ReadonlySet<string>,
  targetKeys: ReadonlySet<string>
): string[] {
  const extra: string[] = []
  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) {
      extra.push(key)
    }
  }
  return extra
}

/**
 * Return keys whose value is the empty string.
 */
export function findEmptyValues(entries: ReadonlyMap<string, string>): string[] {
  const empty: string[] = []
  for (const [key, value] of entries) {
    if (value === '') {
      empty.push(key)
    }
  }
  return empty
}

/**
 * Deterministic strategy selection for translation batching.
 *
 * Thresholds (from the CivicTrack reference implementation):
 *   - maxKeysPerLocale <= 100  AND  estimatedOutputBytes <= 15000  -> single-call
 *   - Otherwise -> per-locale-parallel
 */
export function selectStrategy(
  maxKeysPerLocale: number,
  estimatedOutputBytes: number
): 'single-call' | 'per-locale-parallel' {
  const MAX_KEYS = 100
  const MAX_BYTES = 15_000
  if (maxKeysPerLocale > MAX_KEYS || estimatedOutputBytes > MAX_BYTES) {
    return 'per-locale-parallel'
  }
  return 'single-call'
}

/**
 * Deep-set a value at a dot-separated path in a nested object.
 * Creates intermediate objects as needed.
 * Mutates the input object — this is intentional since we're building the output.
 */
export function setNested(obj: NestedMessages, path: string, value: string): void {
  const parts = path.split('.')
  let cursor: NestedMessages = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!
    const next = cursor[part]
    if (typeof next === 'string') {
      throw new Error(
        `Cannot set "${path}": intermediate "${parts.slice(0, i + 1).join('.')}" is a string, not an object.`
      )
    }
    if (next === undefined) {
      cursor[part] = {}
    }
    cursor = cursor[part] as NestedMessages
  }
  cursor[parts[parts.length - 1]!] = value
}

// ─── mergeTranslations result types ─────────────────────────────────────

interface MergeConflict {
  key: string
  existing: string
  incoming: string
}

interface MergeSuccess {
  ok: true
  merged: NestedMessages
}

interface MergeFailure {
  ok: false
  unknownKeys: string[]
  emptyValues: string[]
  conflicts: MergeConflict[]
}

export type MergeResult = MergeSuccess | MergeFailure

/**
 * Validate and merge incoming translations into an existing locale object.
 *
 * Safety rules:
 *   1. Every key must exist in enKeys (the canonical key set from en.json)
 *   2. Empty string values are rejected
 *   3. Existing non-empty translations are never overwritten (unless same value = idempotent)
 *
 * Returns a result discriminated by `ok`:
 *   - ok: true  -> merged NestedMessages ready to write
 *   - ok: false -> lists of unknownKeys, emptyValues, and conflicts
 */
export function mergeTranslations(
  existing: NestedMessages,
  incoming: Record<string, string>,
  enKeys: ReadonlySet<string>
): MergeResult {
  const unknownKeys: string[] = []
  const emptyValues: string[] = []
  const conflicts: MergeConflict[] = []

  const existingFlat = flattenKeys(existing)

  // Validation pass
  for (const [key, value] of Object.entries(incoming)) {
    if (!enKeys.has(key)) {
      unknownKeys.push(key)
    }
    if (value === '') {
      emptyValues.push(key)
    }
    const existingValue = existingFlat.get(key)
    if (
      existingValue !== undefined &&
      existingValue !== '' &&
      existingValue !== value
    ) {
      conflicts.push({ key, existing: existingValue, incoming: value })
    }
  }

  if (unknownKeys.length > 0 || emptyValues.length > 0 || conflicts.length > 0) {
    return { ok: false, unknownKeys, emptyValues, conflicts }
  }

  // Deep clone to avoid mutating the input
  const merged: NestedMessages = JSON.parse(JSON.stringify(existing))
  for (const [key, value] of Object.entries(incoming)) {
    setNested(merged, key, value)
  }

  return { ok: true, merged }
}
