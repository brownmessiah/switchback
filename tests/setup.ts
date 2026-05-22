// Set placeholder env vars BEFORE any lib code imports happen.
// The ??= operator only sets when undefined, so CI / real .env.local values are preserved.
// vitest sets NODE_ENV=test automatically; we just need to inject the env
// vars that lib/env.ts validates at module load.
process.env['DATABASE_URL'] ??= 'postgres://test:test@localhost:5432/test'
process.env['BETTER_AUTH_SECRET'] ??= 'a'.repeat(32)
process.env['NEXT_PUBLIC_APP_URL'] ??= 'http://localhost:3000'

import '@testing-library/jest-dom/vitest'
