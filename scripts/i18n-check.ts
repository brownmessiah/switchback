/**
 * i18n:check — Validates that every non-English locale file has the same key
 * set as en.json. Reports missing keys, empty values, and extra keys.
 * Exits non-zero on any mismatch. Intended as a CI gate.
 *
 * Usage: pnpm i18n:check
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  flattenKeys,
  findMissingKeys,
  findExtraKeys,
  findEmptyValues,
  type NestedMessages,
} from './i18n-utils'

const MESSAGES_DIR = join(import.meta.dirname, '..', 'lib', 'i18n', 'messages')
const SOURCE_LOCALE = 'en'

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

const sourceFlat = flattenKeys(loadMessages(SOURCE_LOCALE))
const sourceKeySet = new Set(sourceFlat.keys())
const targetLocales = locales.filter((l) => l !== SOURCE_LOCALE)

let hasErrors = false

console.log(`Source: ${SOURCE_LOCALE}.json — ${sourceFlat.size} keys\n`)

for (const locale of targetLocales) {
  const targetFlat = flattenKeys(loadMessages(locale))
  const targetKeySet = new Set(targetFlat.keys())

  const missing = findMissingKeys(sourceKeySet, targetKeySet)
  const empty = findEmptyValues(targetFlat)
  const extra = findExtraKeys(sourceKeySet, targetKeySet)

  if (missing.length === 0 && empty.length === 0 && extra.length === 0) {
    console.log(`  ${locale}.json — ${targetFlat.size} keys — OK`)
  } else {
    hasErrors = true
    console.log(`  ${locale}.json — ${targetFlat.size} keys — ISSUES:`)
    if (missing.length > 0) {
      console.log(`    Missing (${missing.length}):`)
      for (const k of missing) console.log(`      - ${k}`)
    }
    if (empty.length > 0) {
      console.log(`    Empty values (${empty.length}):`)
      for (const k of empty) console.log(`      - ${k}`)
    }
    if (extra.length > 0) {
      console.log(`    Extra keys not in source (${extra.length}):`)
      for (const k of extra) console.log(`      - ${k}`)
    }
  }
}

console.log('')
if (hasErrors) {
  console.error('i18n check FAILED — fix the issues above.')
  process.exit(1)
} else {
  console.log('i18n check PASSED — all locales are in sync.')
}
