// Set placeholder env vars BEFORE any lib code imports happen.
// The ??= operator only sets when undefined, so CI / real .env.local values are preserved.
// vitest sets NODE_ENV=test automatically; we just need to inject the env
// vars that lib/env.ts validates at module load.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['BETTER_AUTH_SECRET'] ??= 'a'.repeat(32)
process.env['NEXT_PUBLIC_APP_URL'] ??= 'http://localhost:3000'

import '@testing-library/jest-dom/vitest'

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Global teardown guard (#109): unmount every React tree rendered by a test
// before the next test (and before the jsdom environment is disposed). Vitest
// runs without `globals`, so React Testing Library does NOT auto-register its
// own afterEach(cleanup) — leaving 'use client' components (e.g. the admin /
// vendor sidebars) mounted with effects that schedule deferred work via the
// scheduler's setImmediate. Under full-suite parallelism that task can fire
// AFTER `window` is torn down, throwing `ReferenceError: window is not defined`
// from performWorkOnRootViaSchedulerTask and tripping `pnpm test` to a
// non-zero exit even though every assertion passed. cleanup() unmounts
// synchronously, cancelling any pending scheduler task. It is idempotent, so
// test files that already call cleanup() in their own afterEach are unaffected.
afterEach(() => {
  cleanup()
})
