import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { applyBrandTokens, resolveBrandTokens } from '../config/brand'

/**
 * Guards the templating contract for the message catalogues: a rebrand must be
 * a config change, not another 13-locale sweep. Locale JSON may reference the
 * support/admin addresses and the product name only through `{supportEmail}`,
 * `{adminEmail}` and `{brandName}` — never as literals.
 */
const MESSAGES_DIR = join(__dirname, 'messages')
const locales = readdirSync(MESSAGES_DIR).filter((f) => f.endsWith('.json'))

describe('message catalogues are brand-templated', () => {
  it('ships a catalogue for every locale', () => {
    expect(locales.length).toBeGreaterThan(0)
  })

  it.each(locales)('%s contains no hardcoded brand email address', (file) => {
    const raw = readFileSync(join(MESSAGES_DIR, file), 'utf8')
    const literals = (raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [])
      // `you@example.com` and friends are input placeholders shown inside form
      // fields. example.com is RFC 2606's reserved example domain, so it can
      // never be a real brand address — it is exempt by definition, not by
      // convenience.
      .filter((address) => !address.endsWith('@example.com'))
    expect(literals).toEqual([])
  })

  it.each(locales)('%s resolves its brand placeholders to real values', (file) => {
    const raw = JSON.parse(readFileSync(join(MESSAGES_DIR, file), 'utf8'))
    const resolved = JSON.stringify(applyBrandTokens(raw, resolveBrandTokens({})))
    expect(resolved).not.toMatch(/\{(supportEmail|adminEmail|brandName|appDomain)\}/)
  })
})
