import { test, expect } from '../../fixtures/devtools'

interface WebVitals {
  ttfb: number | null
  fcp: number | null
  lcp: number | null
  cls: number | null
  domContentLoaded: number | null
  load: number | null
}

async function collectWebVitals(page: import('@playwright/test').Page): Promise<WebVitals> {
  return page.evaluate(() =>
    new Promise<WebVitals>((resolve) => {
      const vitals: WebVitals = {
        ttfb: null,
        fcp: null,
        lcp: null,
        cls: null,
        domContentLoaded: null,
        load: null,
      }

      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (nav) {
        vitals.ttfb = Math.round(nav.responseStart - nav.requestStart)
        vitals.domContentLoaded = Math.round(nav.domContentLoadedEventEnd - nav.startTime)
        vitals.load = Math.round(nav.loadEventEnd - nav.startTime)
      }

      const paintEntries = performance.getEntriesByType('paint')
      const fcpEntry = paintEntries.find((e) => e.name === 'first-contentful-paint')
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
          if (!(entry as PerformanceEntry & { hadRecentInput?: boolean }).hadRecentInput) {
            clsValue += (entry as PerformanceEntry & { value: number }).value
          }
        }
      })

      try { lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true }) } catch {}
      try { clsObserver.observe({ type: 'layout-shift', buffered: true }) } catch {}

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

function reportVitals(pageName: string, vitals: WebVitals): void {
  const lines = [
    `\n  Core Web Vitals: ${pageName}`,
    `  ├─ TTFB:              ${vitals.ttfb ?? '—'} ms`,
    `  ├─ FCP:               ${vitals.fcp ?? '—'} ms`,
    `  ├─ LCP:               ${vitals.lcp ?? '—'} ms`,
    `  ├─ CLS:               ${vitals.cls ?? '—'}`,
    `  ├─ DOMContentLoaded:  ${vitals.domContentLoaded ?? '—'} ms`,
    `  └─ Load:              ${vitals.load ?? '—'} ms`,
  ]
  console.log(lines.join('\n'))
}

test.describe('Core Web Vitals benchmark (non-blocking)', () => {
  test.describe.configure({ mode: 'serial' })

  test('home page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Home (/)', vitals)

    expect(vitals.ttfb).not.toBeNull()
    expect(vitals.fcp).not.toBeNull()

    test.info().annotations.push(
      { type: 'ttfb_ms', description: String(vitals.ttfb) },
      { type: 'fcp_ms', description: String(vitals.fcp) },
      { type: 'lcp_ms', description: String(vitals.lcp) },
      { type: 'cls', description: String(vitals.cls) },
    )
  })

  test('activity-city collection', async ({ page }) => {
    await page.goto('/adventure/rafting-in-rishikesh', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Collection (/adventure/rafting-in-rishikesh)', vitals)

    expect(vitals.ttfb).not.toBeNull()
    expect(vitals.fcp).not.toBeNull()

    test.info().annotations.push(
      { type: 'ttfb_ms', description: String(vitals.ttfb) },
      { type: 'fcp_ms', description: String(vitals.fcp) },
      { type: 'lcp_ms', description: String(vitals.lcp) },
      { type: 'cls', description: String(vitals.cls) },
    )
  })

  test('experience detail', async ({ page }) => {
    await page.goto('/adventure/rafting-in-rishikesh', { waitUntil: 'load' })
    const experienceLink = page.locator('a[href*="/experience/"]').first()
    const href = await experienceLink.getAttribute('href')
    if (!href) {
      test.skip(true, 'No experience links found in collection')
      return
    }

    await page.goto(href, { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals(`Detail (${href})`, vitals)

    expect(vitals.ttfb).not.toBeNull()
    expect(vitals.fcp).not.toBeNull()

    test.info().annotations.push(
      { type: 'ttfb_ms', description: String(vitals.ttfb) },
      { type: 'fcp_ms', description: String(vitals.fcp) },
      { type: 'lcp_ms', description: String(vitals.lcp) },
      { type: 'cls', description: String(vitals.cls) },
    )
  })

  test('search page', async ({ page }) => {
    await page.goto('/search', { waitUntil: 'load' })
    const vitals = await collectWebVitals(page)
    reportVitals('Search (/search)', vitals)

    expect(vitals.ttfb).not.toBeNull()
    expect(vitals.fcp).not.toBeNull()

    test.info().annotations.push(
      { type: 'ttfb_ms', description: String(vitals.ttfb) },
      { type: 'fcp_ms', description: String(vitals.fcp) },
      { type: 'lcp_ms', description: String(vitals.lcp) },
      { type: 'cls', description: String(vitals.cls) },
    )
  })
})
