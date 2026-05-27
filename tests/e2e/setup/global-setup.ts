/**
 * Global setup for the Playwright `setup` project.
 *
 * Runs once before all other projects:
 * 1. Resets the E2E database (drop/create/push/seed)
 * 2. Injects auth sessions for customer, vendor, and admin roles
 *
 * The auth storage state files are written to `tests/e2e/.auth/` and
 * referenced by the per-project `storageState` config.
 */

import { test as setup } from '@playwright/test'
import { resetDatabase } from '../helpers/db-setup'
import { injectSession } from '../helpers/auth-setup'

setup('reset E2E database', async () => {
  await resetDatabase()
})

setup('inject customer session', async () => {
  await injectSession('customer')
})

setup('inject vendor session', async () => {
  await injectSession('vendor')
})

setup('inject admin session', async () => {
  await injectSession('admin')
})
