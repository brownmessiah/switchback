import { copyFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resetDatabase } from './helpers/db-setup'
import { resetPrelaunchDatabase } from './helpers/prelaunch-db-setup'
import { injectSession } from './helpers/auth-setup'

function loadEnvFile() {
  try {
    const envPath = resolve(__dirname, '../../.env.local')
    const content = readFileSync(envPath, 'utf-8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx)
      const value = trimmed.slice(eqIdx + 1)
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  } catch {}
}

async function globalSetup() {
  loadEnvFile()
  console.log('[E2E] Resetting database...')
  await resetDatabase()
  // launch-readiness/04: also provisions the SECOND, isolated pre-launch
  // database (`outvers_e2e_prelaunch`) the `prelaunch*` projects' webServer
  // (port 3100) runs against. Sequential (not Promise.all) with
  // resetDatabase() above — both issue CREATE/DROP DATABASE against the same
  // Postgres server's `postgres` maintenance DB, and concurrent
  // CREATE DATABASE calls can contend on template1; determinism over the
  // (small) time saving.
  console.log('[E2E] Resetting pre-launch database...')
  await resetPrelaunchDatabase()
  console.log('[E2E] Databases ready. Injecting sessions...')
  await injectSession('customer')
  await injectSession('vendor')
  const adminStoragePath = await injectSession('admin')
  await injectSession('subadmin')
  await injectSession('vendor-onboarding')
  await injectSession('identity-vendor')

  // The `responsive-phone-admin` / `responsive-tablet-admin` projects reference
  // `admin-demo-storage.json` (playwright.config.ts), which is gitignored and so
  // never exists in a fresh CI checkout. Without it those projects fail before a
  // single request with an unreadable storageState. The session row injected for
  // `admin` is a fully valid Admin session, so seed the demo storage state from
  // it — the responsive-admin specs only need an authenticated Admin context.
  const adminDemoStoragePath = resolve(__dirname, '.auth/admin-demo-storage.json')
  copyFileSync(adminStoragePath, adminDemoStoragePath)

  console.log('[E2E] Sessions injected. Starting webServer...')
}

export default globalSetup
