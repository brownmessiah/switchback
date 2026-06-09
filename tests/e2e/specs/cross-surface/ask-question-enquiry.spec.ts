/**
 * Cross-surface E2E: PDP "Ask a Question" → Support Ticket → admin queue
 * (issue 17, DECISION D6). @cross-surface
 *
 * Proves the end-to-end claim:
 *   Customer (PDP) asks a question  ──►  experience-category Support Ticket
 *   ──►  the ticket is visible in the existing admin support queue.
 *
 * The default cross-surface `page` carries the ADMIN session (it drives the
 * admin support queue); a secondary `customer` context (customer-storage)
 * opens the PDP and submits the enquiry. The enquiry references the Experience
 * by slug + title only — NO Vendor PII.
 *
 * Cleanup: afterAll deletes the ticket created by this spec, matched by the
 * UNIQUE subject suffix below (support_messages cascade-delete with it).
 */

import postgres from 'postgres'

import path from 'node:path'

import { test, expect } from '../../fixtures/devtools'
import { e2eDbUrl } from '../../helpers/config'

const AUTH_DIR = path.join(__dirname, '../../.auth')

// Seeded published flagship Experience (db/seed.ts) — reliably on the PDP.
const RAFTING_SLUG = 'rishikesh-rafting-grade-iii'

// A unique marker in the question body so the admin row + cleanup target
// exactly this enquiry, even across reruns / retries.
const MARKER = `e2e-ask-${Date.now()}`
const QUESTION = `Is this beginner friendly? (${MARKER})`

test.describe('Cross-surface: Ask a Question → Support Ticket → admin queue @cross-surface', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async () => {
    const sql = postgres(e2eDbUrl(), { max: 1 })
    try {
      // Delete the ticket whose first message carries this run's marker
      // (messages cascade-delete on the ticket FK).
      await sql`
        DELETE FROM support_tickets
        WHERE id IN (
          SELECT ticket_id FROM support_messages WHERE body LIKE ${'%' + MARKER + '%'}
        )
      `
    } finally {
      await sql.end()
    }
  })

  test('customer asks a question on a PDP → confirmation → ticket visible to admin', async ({
    page,
    browser,
  }) => {
    // ── 1. Customer opens the PDP and asks a question ─────────────────────
    const customerContext = await browser.newContext({
      storageState: path.join(AUTH_DIR, 'customer-storage.json'),
    })
    const customerPage = await customerContext.newPage()
    try {
      const resp = await customerPage.goto(`/experience/${RAFTING_SLUG}`)
      expect(resp?.status()).toBe(200)
      await expect(customerPage.locator('h1')).toBeVisible()

      // Open the "Ask a Question" dialog from the desktop booking rail CTA.
      await customerPage
        .getByTestId('ask-question-trigger')
        .first()
        .click()

      // Fill the question and submit.
      await customerPage.getByLabel('Your question').fill(QUESTION)
      await customerPage
        .getByRole('button', { name: /send question/i })
        .click()

      // Confirmation surfaces → the enquiry committed.
      await expect(
        customerPage.getByTestId('ask-question-success'),
      ).toBeVisible()
    } finally {
      await customerPage.close()
      await customerContext.close()
    }

    // ── 2. Admin sees it in the support queue (category=experience) ───────
    // `page` carries the admin session. The new enquiry is an open,
    // experience-category ticket whose subject references the Experience title.
    await page.goto('/admin/support?category=experience')
    await expect(page.locator('h1')).toContainText('Support Tickets')

    // The ticket subject is "Question about {title}"; the rafting flagship's
    // title contains "Rafting". Find the row by that subject text.
    const ticketRow = page
      .locator('[data-ticket-id]')
      .filter({ hasText: /Question about/i })
      .filter({ hasText: /Rafting/i })
    await expect(ticketRow.first()).toBeVisible()
  })
})
