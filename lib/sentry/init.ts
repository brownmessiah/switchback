import * as Sentry from '@sentry/nextjs'

import { env } from '@/lib/env'

/**
 * Shared Sentry init invoked from sentry.{server,client,edge}.config.ts.
 * No-ops when SENTRY_DSN isn't set so local dev runs silently.
 */
export function initSentry(): void {
  if (!env.SENTRY_DSN) return

  Sentry.init({
    dsn: env.SENTRY_DSN,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    environment: env.NODE_ENV,
    enabled: env.NODE_ENV !== 'test',
  })
}
