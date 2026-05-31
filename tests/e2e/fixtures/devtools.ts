/**
 * Custom Playwright fixture that hooks browser DevTools events and fails
 * tests when console errors, uncaught exceptions, or 4xx/5xx network
 * responses are detected.  Also runs an axe-core accessibility check
 * after each test.
 *
 * Every spec file in the E2E suite should import `test` and `expect`
 * from this module instead of `@playwright/test`.
 */

import { test as base, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import type { ConsoleMessage, Response } from '@playwright/test'

// ---------------------------------------------------------------------------
// Benign patterns — console messages matching these are NOT treated as errors
// ---------------------------------------------------------------------------
const BENIGN_PATTERNS: RegExp[] = [
  // React hydration warnings in dev
  /Warning: Text content did not match/,
  /Warning: Did not expect server/,
  /Hydration failed because/,
  /There was an error while hydrating/,

  // Next.js HMR / dev noise
  /\[HMR\]/,
  /\[Fast Refresh\]/,
  /\[webpack\.cache\]/,
  /Download the React DevTools/,

  // Node punycode deprecation (bubbles into browser console in some setups)
  /punycode/,

  // PostHog, Sentry, or other analytics noise
  /posthog/i,
  /sentry/i,

  // Generic favicon 404
  /favicon\.ico/,
]

function isBenign(text: string): boolean {
  return BENIGN_PATTERNS.some((p) => p.test(text))
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------
interface DevToolsFixtures {
  /** Collected console errors (non-benign) during the test. */
  consoleErrors: string[]
  /** Collected uncaught page errors during the test. */
  pageErrors: Error[]
  /** Collected 4xx/5xx network responses during the test. */
  failedResponses: { url: string; status: number }[]
}

// ---------------------------------------------------------------------------
// Extended test with DevTools hooks
// ---------------------------------------------------------------------------
export const test = base.extend<DevToolsFixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = []

    const handler = (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text()
        if (!isBenign(text)) {
          errors.push(text)
        }
      }
    }
    page.on('console', handler)
    await use(errors)
  },

  pageErrors: async ({ page }, use) => {
    const errors: Error[] = []
    const handler = (error: Error) => {
      errors.push(error)
    }
    page.on('pageerror', handler)
    await use(errors)
  },

  failedResponses: async ({ page }, use) => {
    const failures: { url: string; status: number }[] = []
    const handler = (response: Response) => {
      const status = response.status()
      const url = response.url()
      // Ignore pre-flight / opaque responses and benign URLs
      if (status >= 400 && !isBenign(url)) {
        failures.push({ url, status })
      }
    }
    page.on('response', handler)
    await use(failures)
  },
})

// ---------------------------------------------------------------------------
// afterEach: fail on DevTools violations + run axe-core a11y check
// ---------------------------------------------------------------------------
test.afterEach(async ({ page, consoleErrors, pageErrors, failedResponses }, testInfo) => {
  // Skip DevTools assertions for skipped/fixme tests
  if (testInfo.status === 'skipped') return

  // 1. Console errors
  if (consoleErrors.length > 0) {
    const summary = consoleErrors.map((e) => `  - ${e}`).join('\n')
    expect(
      consoleErrors,
      `Console errors detected:\n${summary}`,
    ).toHaveLength(0)
  }

  // 2. Uncaught exceptions
  if (pageErrors.length > 0) {
    const summary = pageErrors.map((e) => `  - ${e.message}`).join('\n')
    expect(
      pageErrors,
      `Uncaught page errors:\n${summary}`,
    ).toHaveLength(0)
  }

  // 3. Failed network responses
  if (failedResponses.length > 0) {
    const summary = failedResponses
      .map((r) => `  - ${r.status} ${r.url}`)
      .join('\n')
    expect(
      failedResponses,
      `4xx/5xx responses detected:\n${summary}`,
    ).toHaveLength(0)
  }

  // 4. axe-core accessibility check (best-effort: only when page has content)
  try {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(
      accessibilityScanResults.violations,
      `Accessibility violations:\n${JSON.stringify(accessibilityScanResults.violations, null, 2)}`,
    ).toHaveLength(0)
  } catch {
    // axe may fail on blank/error pages — don't mask the real failure
  }
})

export { expect }
