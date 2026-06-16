/**
 * E2E for /help (static FAQ help centre) and /contact (lead form → support_ticket).
 *
 * Issue 07:
 *  - /help → 200 + h1 + FAQPage JSON-LD + accordion items.
 *  - /contact → 200 + form present.
 *  - contact submit HAPPY path → fills form, submits, success state, and a real
 *    support_ticket row appears in the e2e DB (verified via db-assertions).
 *  - contact submit ERROR path → invalid email shows a field error, no success.
 *
 * The happy-path test mutates shared DB state (creates a support_ticket), so the
 * suite runs serially and cleans up the rows it created in afterAll.
 */

import { test, expect } from '../../fixtures/devtools'
import {
  deleteGuestContactTicketsBySubject,
  getFirstSupportMessageBody,
  getLatestGuestContactTicketBySubject,
} from '../../helpers/db-assertions'

test.describe.configure({ mode: 'serial' })

// Unique subject so the assertions + cleanup target only this run's row.
const SUBJECT = `E2E contact probe ${Date.now()}`
const EMAIL = 'e2e-contact@example.com'

test.afterAll(async () => {
  await deleteGuestContactTicketsBySubject(SUBJECT)
})

// ---------------------------------------------------------------------------
// /help — static FAQ help centre
// ---------------------------------------------------------------------------
test.describe('Help centre', () => {
  test('renders H1, FAQPage JSON-LD, and accordion items', async ({ page }) => {
    const response = await page.goto('/help')
    expect(response?.status()).toBe(200)

    await expect(page.locator('h1')).toBeVisible()

    // FAQPage JSON-LD with at least one Question entity.
    const jsonLdScripts = page.locator('script[type="application/ld+json"]')
    const count = await jsonLdScripts.count()
    expect(count).toBeGreaterThanOrEqual(2)

    let foundFaq = false
    let foundBreadcrumb = false
    for (let i = 0; i < count; i++) {
      const content = await jsonLdScripts.nth(i).textContent()
      if (!content) continue
      const parsed = JSON.parse(content) as Record<string, unknown>
      if (parsed['@type'] === 'FAQPage') {
        foundFaq = true
        const entities = parsed.mainEntity as Array<{ '@type': string; name: string }>
        expect(entities.length).toBeGreaterThanOrEqual(8)
        expect(entities[0]['@type']).toBe('Question')
      }
      if (parsed['@type'] === 'BreadcrumbList') foundBreadcrumb = true
    }
    expect(foundFaq).toBe(true)
    expect(foundBreadcrumb).toBe(true)

    // Accordion items render as expandable triggers.
    const triggers = page.locator('[data-slot="accordion-trigger"]')
    expect(await triggers.count()).toBeGreaterThanOrEqual(8)

    // Expanding the first item reveals its answer panel.
    await triggers.first().click()
    await expect(page.locator('[data-slot="accordion-content"]').first()).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/help.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// /contact — lead form → support_ticket
// ---------------------------------------------------------------------------
test.describe('Contact form', () => {
  test('renders the lead form', async ({ page }) => {
    const response = await page.goto('/contact')
    expect(response?.status()).toBe(200)

    await expect(page.locator('h1')).toBeVisible()
    await expect(page.getByTestId('contact-form')).toBeVisible()
    await expect(page.getByTestId('contact-submit')).toBeVisible()

    await page.screenshot({
      path: 'tests/e2e/screenshots/contact.png',
      fullPage: true,
    })
  })

  test('invalid email shows a field error and does NOT submit', async ({ page }) => {
    await page.goto('/contact')

    // `input[name="email"]` also matches the footer newsletter form, so scope
    // every field lookup to the contact form (data-testid="contact-form").
    const form = page.getByTestId('contact-form')
    await form.locator('input[name="name"]').fill('Error Path Tester')
    await form.locator('input[name="email"]').fill('not-an-email')
    await form.locator('input[name="subject"]').fill('Invalid email subject')
    await form
      .locator('textarea[name="message"]')
      .fill('This message is long enough to pass the length check.')

    await page.getByTestId('contact-submit').click()

    // An email field error is shown; success state never appears.
    await expect(
      form.getByText('valid email address', { exact: false }),
    ).toBeVisible()
    await expect(page.getByTestId('contact-success')).toHaveCount(0)
  })

  test('happy path: submit creates a support_ticket and shows success', async ({ page }) => {
    await page.goto('/contact')

    await page.locator('input[name="name"]').fill('Happy Path Tester')
    await page.locator('input[name="email"]').fill(EMAIL)
    await page.locator('input[name="subject"]').fill(SUBJECT)
    await page
      .locator('textarea[name="message"]')
      .fill('I have a question about my upcoming rafting Booking and the refund window.')

    await page.getByTestId('contact-submit').click()

    // Success state is shown (never a silent no-op).
    await expect(page.getByTestId('contact-success')).toBeVisible()

    // A real support_ticket row appeared, attributed to the guest-contact User,
    // open/medium/other, with the submitter name + their subject.
    const ticket = await getLatestGuestContactTicketBySubject(SUBJECT)
    expect(ticket).not.toBeNull()
    expect(ticket!.status).toBe('open')
    expect(ticket!.priority).toBe('medium')
    expect(ticket!.category).toBe('other')
    expect(ticket!.subject).toContain('Happy Path Tester')
    expect(ticket!.subject).toContain(SUBJECT)

    // The first support_message carries the message + the submitter email so an
    // Admin can reply.
    const body = await getFirstSupportMessageBody(ticket!.id)
    expect(body).toBeTruthy()
    expect(body!).toContain(EMAIL)
    expect(body!).toContain('rafting Booking')
  })
})
