/**
 * Shared Core Web Vitals capture helper for the NON-BLOCKING CWV benchmark
 * specs (Issue #111).
 *
 * Used by:
 *   - tests/e2e/specs/unauthenticated/benchmark.spec.ts (marketing pages)
 *   - tests/e2e/specs/customer/benchmark.spec.ts        (authenticated pages)
 *
 * IMPORTANT — these benchmarks are intentionally NON-BLOCKING. This module
 * provides capture + logging + annotation utilities only; it adds NO pass/fail
 * CWV thresholds. Callers should keep their assertions lenient (e.g. assert the
 * page rendered, then capture vitals as logs/annotations) so the full suite
 * stays green. Dev-mode numbers (unminified, dev server) are a RELATIVE
 * baseline only — not production-representative.
 */

import type { Page, TestInfo } from '@playwright/test'

export interface WebVitals {
  ttfb: number | null
  fcp: number | null
  lcp: number | null
  cls: number | null
  domContentLoaded: number | null
  load: number | null
}

/**
 * Collect navigation timing + paint + LCP + CLS from the live page. Observes
 * the `largest-contentful-paint` and `layout-shift` PerformanceObserver streams
 * (buffered) for a fixed settle window, then resolves the snapshot.
 */
export async function collectWebVitals(page: Page): Promise<WebVitals> {
  return page.evaluate(
    () =>
      new Promise<WebVitals>((resolve) => {
        const vitals: WebVitals = {
          ttfb: null,
          fcp: null,
          lcp: null,
          cls: null,
          domContentLoaded: null,
          load: null,
        }

        const nav = performance.getEntriesByType('navigation')[0] as
          | PerformanceNavigationTiming
          | undefined
        if (nav) {
          vitals.ttfb = Math.round(nav.responseStart - nav.requestStart)
          vitals.domContentLoaded = Math.round(
            nav.domContentLoadedEventEnd - nav.startTime,
          )
          vitals.load = Math.round(nav.loadEventEnd - nav.startTime)
        }

        const paintEntries = performance.getEntriesByType('paint')
        const fcpEntry = paintEntries.find(
          (e) => e.name === 'first-contentful-paint',
        )
        if (fcpEntry) vitals.fcp = Math.round(fcpEntry.startTime)

        let lcpValue: number | null = null
        let clsValue = 0

        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries()
          if (entries.length > 0) {
            lcpValue = Math.round(entries[entries.length - 1]!.startTime)
          }
        })

        const clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (
              !(entry as PerformanceEntry & { hadRecentInput?: boolean })
                .hadRecentInput
            ) {
              clsValue += (entry as PerformanceEntry & { value: number }).value
            }
          }
        })

        try {
          lcpObserver.observe({
            type: 'largest-contentful-paint',
            buffered: true,
          })
        } catch {}
        try {
          clsObserver.observe({ type: 'layout-shift', buffered: true })
        } catch {}

        setTimeout(() => {
          lcpObserver.disconnect()
          clsObserver.disconnect()
          vitals.lcp = lcpValue
          vitals.cls = Math.round(clsValue * 1000) / 1000
          resolve(vitals)
        }, 3000)
      }),
  )
}

/** Pretty-print the captured vitals to the test runner console (non-blocking). */
export function reportVitals(pageName: string, vitals: WebVitals): void {
  const lines = [
    `\n  Core Web Vitals: ${pageName}`,
    `  ├─ TTFB:              ${vitals.ttfb ?? '—'} ms`,
    `  ├─ FCP:               ${vitals.fcp ?? '—'} ms`,
    `  ├─ LCP:               ${vitals.lcp ?? '—'} ms`,
    `  ├─ CLS:               ${vitals.cls ?? '—'}`,
    `  ├─ DOMContentLoaded:  ${vitals.domContentLoaded ?? '—'} ms`,
    `  └─ Load:              ${vitals.load ?? '—'} ms`,
  ]
  // eslint-disable-next-line no-console -- benchmark capture is intentional log output
  console.log(lines.join('\n'))
}

/** Attach the core vitals as test annotations (surfaced in the HTML report). */
export function pushVitalsAnnotations(testInfo: TestInfo, vitals: WebVitals): void {
  testInfo.annotations.push(
    { type: 'ttfb_ms', description: String(vitals.ttfb) },
    { type: 'fcp_ms', description: String(vitals.fcp) },
    { type: 'lcp_ms', description: String(vitals.lcp) },
    { type: 'cls', description: String(vitals.cls) },
  )
}
