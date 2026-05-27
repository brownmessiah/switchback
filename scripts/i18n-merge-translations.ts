/**
 * i18n:merge — Reads translated keys from `.i18n-work/translated.json` and
 * merges them into the corresponding locale files.
 *
 * Safety rules:
 *   1. Every key must exist in en.json (unknown keys rejected)
 *   2. Never overwrites existing non-empty translations
 *   3. Empty-string values in input are rejected
 *   4. Idempotent: running with same input twice is a no-op on second run
 *   5. Preserves nested JSON structure and key ordering
 *
 * Usage: pnpm i18n:merge [path-to-translated.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  flattenKeys,
  mergeTranslations,
  type NestedMessages,
} from './i18n-utils'

const MESSAGES_DIR = join(import.meta.dirname, '..', 'lib', 'i18n', 'messages')
const WORK_DIR = join(import.meta.dirname, '..', '.i18n-work')
const INPUT_FILE = process.argv[2] ?? join(WORK_DIR, 'translated.json')
const SOURCE_LOCALE = 'en'

function loadMessages(locale: string): NestedMessages {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), 'utf-8'))
}

// ─── Load input ──────────────────────────────────────────────────────────

if (!existsSync(INPUT_FILE)) {
  console.error(`Input file not found: ${INPUT_FILE}`)
  console.error('Usage: tsx scripts/i18n-merge-translations.ts [path-to-translated.json]')
  process.exit(1)
}

let input: Record<string, Record<string, string>>
try {
  input = JSON.parse(readFileSync(INPUT_FILE, 'utf-8'))
} catch (err) {
  console.error(`Failed to parse ${INPUT_FILE}: ${(err as Error).message}`)
  process.exit(1)
}

if (typeof input !== 'object' || Array.isArray(input)) {
  console.error(`Expected object at top level, got ${typeof input}.`)
  process.exit(1)
}

// ─── Validate and merge per locale ──────────────────────────────────────

const sourceFlat = flattenKeys(loadMessages(SOURCE_LOCALE))
const enKeys = new Set(sourceFlat.keys())

let hasErrors = false
let totalMerged = 0

for (const [locale, entries] of Object.entries(input)) {
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    console.error(`Expected object for locale "${locale}", got ${typeof entries}.`)
    process.exit(1)
  }

  const existing = loadMessages(locale)
  const result = mergeTranslations(existing, entries, enKeys)

  if (!result.ok) {
    hasErrors = true
    if (result.unknownKeys.length > 0) {
      console.error(`[${locale}] Unknown keys not in en.json (${result.unknownKeys.length}):`)
      for (const key of result.unknownKeys) console.error(`  ${key}`)
    }
    if (result.emptyValues.length > 0) {
      console.error(`[${locale}] Empty translations (${result.emptyValues.length}):`)
      for (const key of result.emptyValues) console.error(`  ${key}`)
    }
    if (result.conflicts.length > 0) {
      console.error(
        `[${locale}] Refusing to overwrite ${result.conflicts.length} existing non-empty translation(s):`
      )
      for (const { key, existing: ex, incoming } of result.conflicts) {
        console.error(`  ${key}`)
        console.error(`    existing: ${JSON.stringify(ex)}`)
        console.error(`    incoming: ${JSON.stringify(incoming)}`)
      }
    }
    continue
  }

  // Write the merged result
  const outPath = join(MESSAGES_DIR, `${locale}.json`)
  writeFileSync(outPath, JSON.stringify(result.merged, null, 2) + '\n', 'utf-8')
  const count = Object.keys(entries).length
  console.log(`  ${locale}: +${count} key(s)`)
  totalMerged += count
}

if (hasErrors) {
  console.error('\nMerge FAILED — fix the issues above.')
  process.exit(1)
}

console.log(`\nMerged ${totalMerged} translation(s) across ${Object.keys(input).length} locale(s).`)
