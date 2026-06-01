/**
 * E2E: customer-facing support tickets (Issue 10).
 *
 * Serial flow for the seeded customer (u_seed_customer, injected via
 * tests/e2e/.auth/customer-storage.json):
 *   1. Open /support and submit a new ticket.
 *   2. See it in "my tickets".
 *   3. Open the thread.
 *   4. Reply, and confirm the reply renders in the thread.
 *
 * Cleanup: afterAll deletes every ticket created by this spec, matched by
 * the UNIQUE subject set below (and the messages cascade-delete with it).
 *
 * Uses the DevTools fixture for automatic console-error, uncaught-exception,
 * network-failure, and axe-core accessibility checks after each test.
 */

import postgres from 'postgres'

import { test, expect } from '../../fixtures/devtools'
import { e2eDbUrl } from '../../helpers/config'

// Unique subject so afterAll can delete exactly what this spec created,
// even under retries (the timestamp keeps reruns distinct from any leftover).
const SUBJECT = `[e2e-support] My booking question ${Date.now()}`
const FIRST_MESSAGE = 'I have a question about my upcoming booking.'
const REPLY_BODY = 'Adding a follow-up detail to my support request.'

test.describe.configure({ mode: 'serial' })

test.describe('Customer support tickets', () => {
  test.afterAll(async () => {
    const sql = postgres(e2eDbUrl(), { max: 1 })
    try {
      // support_messages cascade-delete on the ticket FK (onDelete: cascade).
      await sql`DELETE FROM support_tickets WHERE subject = ${SUBJECT}`
    } finally {
      await sql.end()
    }
  })

  test('creates a ticket → lists it → opens thread → replies', async ({ page }) => {
    // ── 1. Open the support page ──────────────────────────────────────
    const response = await page.goto('/support')
    expect(response?.status()).toBe(200)
    await expect(page.getByTestId('customer-support')).toBeVisible()

    // ── 2. Submit a new ticket ────────────────────────────────────────
    const form = page.getByTestId('new-ticket-form')
    await form.getByLabel('Subject').fill(SUBJECT)
    await form.getByLabel('Message').fill(FIRST_MESSAGE)
    await form.getByRole('button', { name: /submit ticket/i }).click()

    // Success notice confirms the server action committed.
    await expect(page.getByTestId('ticket-success')).toBeVisible()

    // ── 3. See it in "my tickets" ─────────────────────────────────────
    const listItem = page
      .getByTestId('support-ticket-list')
      .locator('li')
      .filter({ hasText: SUBJECT })
    await expect(listItem).toHaveCount(1)

    // ── 4. Open the thread ────────────────────────────────────────────
    await listItem.getByRole('link').first().click()
    await expect(page.getByTestId('customer-support-thread')).toBeVisible()
    await expect(page.getByRole('heading', { name: SUBJECT })).toBeVisible()

    // The first message (created with the ticket) renders in the thread.
    await expect(
      page.getByTestId('thread-message').filter({ hasText: FIRST_MESSAGE }),
    ).toHaveCount(1)

    // ── 5. Reply ──────────────────────────────────────────────────────
    const replyForm = page.getByTestId('reply-form')
    await replyForm.getByLabel('Reply').fill(REPLY_BODY)
    await replyForm.getByRole('button', { name: /send reply/i }).click()

    // The reply appends to the thread.
    await expect(
      page.getByTestId('thread-message').filter({ hasText: REPLY_BODY }),
    ).toHaveCount(1)
    await expect(page.getByTestId('thread-message')).toHaveCount(2)
  })
})
