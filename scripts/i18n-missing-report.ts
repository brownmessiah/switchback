/**
 * i18n:missing — Generates a structured report at `.i18n-work/missing.json`
 * listing all missing or empty keys per locale, with their English source strings.
 *
 * Selects a translation strategy:
 *   - single-call:         <100 keys per locale AND estimated output <15KB
 *   - per-locale-parallel: otherwise
 *
 * Usage: pnpm i18n:missing
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { flattenKeys, selectStrategy, type NestedMessages } from './i18n-utils'

const MESSAGES_DIR = join(import.meta.dirname, '..', 'lib', 'i18n', 'messages')
const WORK_DIR = join(import.meta.dirname, '..', '.i18n-work')
const OUTPUT_FILE = join(WORK_DIR, 'missing.json')
const SOURCE_LOCALE = 'en'
const NON_LATIN_SCRIPT_MULTIPLIER = 3

function loadMessages(locale: string): NestedMessages {
  const filePath = join(MESSAGES_DIR, `${locale}.json`)
  return JSON.parse(readFileSync(filePath, 'utf-8'))
}

const files = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))
const locales = files.map((f) => f.replace('.json', ''))

if (!locales.includes(SOURCE_LOCALE)) {
  console.error(`Source locale "${SOURCE_LOCALE}.json" not found in ${MESSAGES_DIR}`)
  process.exit(1)
}

const sourceKeys = flattenKeys(loadMessages(SOURCE_LOCALE))
const targetLocales = locales.filter((l) => l !== SOURCE_LOCALE)

const report: Record<string, Record<string, string>> = {}
let totalMissing = 0

for (const locale of targetLocales) {
  const targetKeys = flattenKeys(loadMessages(locale))
  const localeReport: Record<string, string> = {}

  for (const [key, englishValue] of sourceKeys) {
    const existing = targetKeys.get(key)
    if (existing === undefined || existing === '') {
      localeReport[key] = englishValue
    }
  }

  const count = Object.keys(localeReport).length
  if (count > 0) {
    report[locale] = localeReport
    totalMissing += count
  }
}

mkdirSync(WORK_DIR, { recursive: true })

// Build output with strategy metadata
const maxKeysInAnyLocale = Math.max(
  0,
  ...Object.values(report).map((keys) => Object.keys(keys).length)
)

const totalEnglishSourceBytes = Object.values(report)
  .flatMap((keys) => Object.values(keys))
  .reduce((sum, val) => sum + val.length, 0)

const estimatedOutputBytes = totalEnglishSourceBytes * NON_LATIN_SCRIPT_MULTIPLIER

const strategy = selectStrategy(maxKeysInAnyLocale, estimatedOutputBytes)

const output = {
  _meta: {
    totalMissing,
    localesWithMissing: Object.keys(report).length,
    maxKeysInAnyLocale,
    estimatedOutputBytes,
    strategy,
  },
  locales: report,
}

writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + '\n', 'utf-8')

if (totalMissing === 0) {
  console.log('No missing keys. All non-English locales are in sync with en.json.')
  process.exit(0)
}

const localesWithMissing = Object.keys(report).length

console.log(
  `${totalMissing} missing/empty key(s) across ${localesWithMissing} locale(s). Report written to:`
)
console.log(`  ${OUTPUT_FILE}`)
console.log('\nBreakdown:')
for (const [locale, keys] of Object.entries(report)) {
  console.log(`  ${locale}: ${Object.keys(keys).length}`)
}

const reason =
  strategy === 'single-call'
    ? `max ${maxKeysInAnyLocale} keys/locale (<=100), estimated output ${estimatedOutputBytes}B (<=15000B)`
    : `${maxKeysInAnyLocale > 100 ? `max ${maxKeysInAnyLocale} keys/locale >100` : ''}${
        maxKeysInAnyLocale > 100 && estimatedOutputBytes > 15_000 ? ', ' : ''
      }${estimatedOutputBytes > 15_000 ? `estimated output ${estimatedOutputBytes}B >15000B` : ''}`

console.log('\n──────────────────────────────────────────────────────────────')
console.log(`STRATEGY: ${strategy}`)
console.log(`REASON:   ${reason}`)
console.log('──────────────────────────────────────────────────────────────')
if (strategy === 'single-call') {
  console.log('-> Read missing.json in one pass, write all translations to')
  console.log('  .i18n-work/translated.json, then run `pnpm i18n:merge`.')
} else {
  console.log(
    `-> Dispatch ${localesWithMissing} translation agents in parallel (one per locale`
  )
  console.log('  with missing keys). Each agent translates ONLY its assigned')
  console.log('  locale block. Orchestrator merges partial outputs into')
  console.log('  .i18n-work/translated.json, then runs `pnpm i18n:merge`.')
}
