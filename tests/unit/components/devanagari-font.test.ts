import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Tests for the Noto Sans Devanagari font loading strategy.
 *
 * The actual font loading is handled by next/font/google in app/layout.tsx.
 * These tests verify the CSS and data-attribute coordination that controls
 * when the Devanagari font is applied.
 */

const ROOT = resolve(__dirname, '../../..')

describe('Devanagari font loading strategy', () => {
  it('globals.css contains data-locale="hi" font-family override', () => {
    const css = readFileSync(resolve(ROOT, 'app/globals.css'), 'utf-8')

    expect(css).toContain('html[data-locale="hi"]')
    expect(css).toContain('--font-devanagari')
  })

  it('layout.tsx imports Noto_Sans_Devanagari', () => {
    const layout = readFileSync(resolve(ROOT, 'app/layout.tsx'), 'utf-8')

    expect(layout).toContain('Noto_Sans_Devanagari')
    expect(layout).toContain('--font-devanagari')
  })

  it('layout.tsx conditionally applies devanagari variable only for hi locale', () => {
    const layout = readFileSync(resolve(ROOT, 'app/layout.tsx'), 'utf-8')

    // Verify the conditional logic: isHindi check and conditional variable application
    expect(layout).toContain('isHindi')
    expect(layout).toContain('locale === "hi"')
    expect(layout).toContain('notoDevanagari.variable')
    expect(layout).toContain('data-locale={locale}')
  })
})
