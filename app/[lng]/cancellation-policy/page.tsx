import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactElement } from 'react'

import { env } from '@/lib/env'

/**
 * Cancellation policy SEO + trust content per ADR-0005.
 *
 * Two reasons this page is load-bearing, not decorative:
 *   1. Indian-incumbent research identified policy *transparency*, not
 *      generosity, as the wedge. Thrillophilia's customer complaints are
 *      about ambiguity. Indiahikes turned their policy into a blog post
 *      that ranks. A clear, linkable policy page is the trust artefact.
 *   2. ADR-0005 says "link to it from every Experience card"; the link
 *      is present in the site header + footer and every booking
 *      confirmation. This page is the canonical destination.
 *
 * Content is fully static — no DB query. Server Component, ISR n/a.
 */

interface PageProps {
  params: Promise<{ lng: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { lng } = await params
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return {
    title: 'Refund and cancellation policy · Outvers',
    description:
      'Outvers refund policy explained — Flexible, Moderate, Strict presets, refund SLA, vendor-cancelled bookings, and how to request a cashout from your wallet.',
    alternates: {
      canonical: `${baseUrl}/${lng === 'en' ? '' : `${lng}/`}cancellation-policy`,
    },
  }
}

interface PresetRow {
  preset: 'Flexible' | 'Moderate' | 'Strict'
  free: string
  half: string
  after: string
  exampleTitle: string
  exampleBody: string
}

const PRESETS: PresetRow[] = [
  {
    preset: 'Flexible',
    free: 'Up to 24 hours before start',
    half: 'Up to 2 hours before start',
    after: 'No refund',
    exampleTitle: 'A short day trip — Rishikesh rafting at 9 AM Saturday',
    exampleBody:
      'Cancel by Friday 9 AM → full refund. Cancel Friday 9 AM to Saturday 7 AM → 50% refund. After 7 AM Saturday → no refund.',
  },
  {
    preset: 'Moderate',
    free: 'Up to 72 hours before start',
    half: 'Up to 24 hours before start',
    after: 'No refund',
    exampleTitle: 'A weekend trek starting Saturday 6 AM',
    exampleBody:
      'Cancel by Wednesday 6 AM → full refund. Cancel Wednesday 6 AM to Friday 6 AM → 50% refund. After Friday 6 AM → no refund.',
  },
  {
    preset: 'Strict',
    free: 'Up to 14 days before start',
    half: 'Up to 7 days before start',
    after: 'No refund',
    exampleTitle: 'A multi-day Himalayan trek starting on the 20th',
    exampleBody:
      'Cancel by the 6th → full refund. Cancel between the 6th and the 13th → 50% refund. After the 13th → no refund.',
  },
]

export default async function CancellationPolicyPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { lng } = await params
  const prefix = lng === 'en' ? '' : `/${lng}`

  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-500">
          <Link href={`${prefix}/`} className="hover:text-zinc-700 dark:hover:text-zinc-300">
            Home
          </Link>{' '}
          <span aria-hidden>›</span>{' '}
          <span aria-current="page" className="text-zinc-700 dark:text-zinc-300">
            Refund policy
          </span>
        </nav>
        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-zinc-900 sm:text-4xl dark:text-zinc-50">
          Refund and cancellation policy
        </h1>
        <p className="mt-4 text-base text-zinc-600 dark:text-zinc-400">
          Every Outvers Experience has one of three named cancellation presets —
          Flexible, Moderate, or Strict. The preset is locked when you book and is
          shown on every Experience card, the checkout page, the confirmation
          email, and the WhatsApp confirmation. Refund math is a pure function of
          the preset, your cancellation timestamp, and the booking total. No
          human review inside the policy window.
        </p>
      </header>

      <section aria-label="The three presets" className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          The three presets
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-300 dark:border-zinc-700">
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  Preset
                </th>
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  Full refund up to
                </th>
                <th className="py-3 pr-4 font-semibold text-zinc-700 dark:text-zinc-300">
                  50% refund up to
                </th>
                <th className="py-3 font-semibold text-zinc-700 dark:text-zinc-300">
                  After that
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {PRESETS.map((row) => (
                <tr key={row.preset}>
                  <td className="py-3 pr-4 font-medium text-zinc-900 dark:text-zinc-50">
                    {row.preset}
                  </td>
                  <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                    {row.free}
                  </td>
                  <td className="py-3 pr-4 text-zinc-700 dark:text-zinc-300">
                    {row.half}
                  </td>
                  <td className="py-3 text-zinc-700 dark:text-zinc-300">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-label="Worked examples" className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Worked examples
        </h2>
        <ul className="space-y-5">
          {PRESETS.map((row) => (
            <li
              key={row.preset}
              className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <h3 className="text-base font-medium text-zinc-900 dark:text-zinc-50">
                {row.preset} — {row.exampleTitle}
              </h3>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {row.exampleBody}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Special cases" className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Special cases
        </h2>
        <dl className="space-y-5">
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              Vendor-cancelled bookings
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              If a vendor cancels — weather, equipment failure, staffing — you
              receive a 100% refund regardless of preset. The vendor&apos;s
              response-time SLA score takes a hit.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              Bookings outside the policy window
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              If you cancel after the experience start time, the cancellation
              opens a dispute. Resolution is at admin discretion; declined by
              default except in clear vendor-fault cases.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-900 dark:text-zinc-50">
              Custom policies
            </dt>
            <dd className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              A small number of high-altitude expeditions and festival-day
              experiences have a Custom policy with non-refundable permits or
              guide deposits. These are admin-approved at listing time and shown
              in plain language on the Experience page.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Refund SLA" className="mb-12">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          When you&apos;ll see the money
        </h2>
        <p className="text-base text-zinc-700 dark:text-zinc-300">
          Eligible refunds credit to your Outvers wallet within 24 hours of an
          inside-policy cancellation. The wallet balance is spendable on any
          future booking; you can request a cashout to your original payment
          method any time — Razorpay round-trips bank transfers in 5–7 working
          days.
        </p>
      </section>

      <section aria-label="Questions">
        <h2 className="mb-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Still have questions?
        </h2>
        <p className="text-base text-zinc-700 dark:text-zinc-300">
          Email{' '}
          <a
            href="mailto:support@outvers.com"
            className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-50"
          >
            support@outvers.com
          </a>{' '}
          or use the in-app chat on any booking — disputes filed inside the
          policy window are resolved within 48 hours.
        </p>
      </section>
    </main>
  )
}
