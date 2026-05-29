import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resetDatabase } from './helpers/db-setup'
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
  console.log('[E2E] Database ready. Injecting sessions...')
  await injectSession('customer')
  await injectSession('vendor')
  await injectSession('admin')
  await injectSession('vendor-onboarding')
  await injectSession('identity-vendor')
  console.log('[E2E] Sessions injected. Starting webServer...')
}

export default globalSetup
