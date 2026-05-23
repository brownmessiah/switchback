import { z } from 'zod'

const schema = z.object({
  // ===== Required =====
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 chars'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // ===== Auth (optional in M1; required by M2) =====
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),

  // ===== Payments (M2) =====
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // ===== AI (M4) =====
  OPENAI_API_KEY: z.string().optional(),

  // ===== Email (M2) =====
  RESEND_API_KEY: z.string().optional(),

  // ===== Maps =====
  MAPBOX_TOKEN: z.string().optional(),

  // ===== Search (M2) =====
  MEILISEARCH_HOST: z.url().optional(),
  MEILISEARCH_KEY: z.string().optional(),

  // ===== Cron auth (M2) =====
  CRON_SECRET: z.string().optional(),

  // ===== Real-time (M3) =====
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),

  // ===== Rate-limit / idempotency =====
  UPSTASH_REDIS_REST_URL: z.url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // ===== Observability =====
  SENTRY_DSN: z.url().optional(),
  POSTHOG_API_KEY: z.string().optional(),

  // ===== Storage (R2) =====
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
})

export type Env = z.infer<typeof schema>

export function parseEnv(input: Record<string, string | undefined> = process.env): Env {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Environment validation failed: ${issues}`)
  }
  return result.data
}

export const env = parseEnv()
