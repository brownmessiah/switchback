import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Infra/code divergence guard.
 *
 * REGRESSION: terraform/compute-run.tf set `RAZORPAY_TEST_MODE = "true"` in the
 * Cloud Run env while Dockerfile bakes `ENV NODE_ENV=production`. Both
 * lib/payments/razorpay-client.ts and lib/payments/razorpay-signature.ts THROW
 * on exactly that combination, so every checkout, refund, capture and webhook
 * verification returned 500 on production — silently, because getRazorpayClient
 * is lazy and the rest of the site renders fine.
 *
 * Nothing caught it: the unit tests assert the guard against `process.env`, and
 * no test ever compared the guard to the deployed configuration. CI has no
 * terraform validate/plan step. These tests close that gap by reading the
 * terraform source directly.
 *
 * They are deliberately source-text assertions rather than a parsed HCL model:
 * the invariant is "this string must not appear in production config", and that
 * is exactly what a reviewer would grep for.
 */

const ROOT = resolve(__dirname, '../../..')
const computeRun = readFileSync(resolve(ROOT, 'terraform/compute-run.tf'), 'utf-8')
const secretsTf = readFileSync(resolve(ROOT, 'terraform/secrets.tf'), 'utf-8')

/** Strip `#` comments so a comment explaining the trap is not read as the trap. */
function withoutComments(hcl: string): string {
  return hcl
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join('\n')
}

describe('terraform runtime env vs the application guards', () => {
  const activeConfig = withoutComments(computeRun)

  it('never sets RAZORPAY_TEST_MODE in the deployed environment', () => {
    // razorpay-client.ts and razorpay-signature.ts both throw when this is
    // 'true' and NODE_ENV is 'production'. The flag forces an in-process DEMO
    // STUB that fabricates order/payment/refund ids — it must never reach a
    // real deployment, and the guards enforce that by refusing to construct.
    expect(activeConfig).not.toMatch(/RAZORPAY_TEST_MODE/)
  })

  it('never overrides NODE_ENV away from the image default', () => {
    // Dockerfile sets NODE_ENV=production. Overriding it in terraform would
    // silently disable every production guard in the codebase at once.
    expect(activeConfig).not.toMatch(/NODE_ENV/)
  })

  it('keeps the cron service inheriting the web env, so a fix cannot land on only one', () => {
    // cron_plain_env is a merge over web_plain_env; if that ever forks, a
    // variable can be fixed on web and left broken on cron.
    expect(activeConfig).toMatch(/cron_plain_env\s*=\s*merge\(local\.web_plain_env/)
  })
})

describe('secrets required by production code paths are provisioned', () => {
  const secretIds = withoutComments(secretsTf)
  const envKeys = withoutComments(computeRun)

  // Every secret the runtime dereferences must exist as a container AND be
  // wired into the service, or Cloud Run fails to boot / the handler 500s.
  it.each([
    ['DATABASE_URL', 'every query'],
    ['BETTER_AUTH_SECRET', 'session signing'],
    ['RAZORPAY_KEY_ID', 'order creation'],
    ['RAZORPAY_KEY_SECRET', 'order creation'],
    ['RAZORPAY_WEBHOOK_SECRET', 'payment confirmation — without it every webhook 500s and paid Bookings are never confirmed'],
    ['RAZORPAYX_WEBHOOK_SECRET', 'payout status'],
  ])('%s is declared as a Secret Manager container (%s)', (secret) => {
    expect(secretIds).toMatch(new RegExp(`"${secret}"`))
  })

  it.each([
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'RAZORPAYX_WEBHOOK_SECRET',
  ])('%s is injected into the Cloud Run services', (secret) => {
    expect(envKeys).toMatch(new RegExp(`"${secret}"`))
  })
})

describe('terraform config matches deployed reality', () => {
  const edgeTf = withoutComments(readFileSync(resolve(ROOT, 'terraform/edge.tf'), 'utf-8'))

  /**
   * The live HTTPS proxy serves `outvers-cert-2`: the original `outvers-cert`
   * stuck in FAILED_NOT_VISIBLE during the domain cutover and was recreated
   * under a new name, but the rename was never codified. While the config said
   * `outvers-cert`, ANY `terraform apply` — including a well-intentioned one
   * fixing something unrelated — would swap the proxy back to a certificate
   * that no longer serves, taking TLS down on https://outvers.com.
   */
  it('names the certificate that is actually attached to the live proxy', () => {
    expect(edgeTf).toMatch(/name\s*=\s*"outvers-cert-2"/)
    expect(edgeTf).not.toMatch(/name\s*=\s*"outvers-cert"/)
  })

  it('protects the certificate from being destroyed by a stray apply', () => {
    expect(edgeTf).toMatch(/prevent_destroy\s*=\s*true/)
  })
})
