import Link from 'next/link'
import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { ArrowRight, Compass, Sparkles } from 'lucide-react'

import { BlogPostCard } from '@/components/blog/blog-post-card'
import { HomeHowItWorks } from '@/components/home/how-it-works'
import { HomeTrust } from '@/components/home/trust'
import { buttonVariants } from '@/components/ui/button'
import type { BlogPostListItem } from '@/lib/blog/queries'

/**
 * The pre-launch home page (launch-readiness 04).
 *
 * Rendered while no publicly-visible Experience exists. An empty
 * marketplace needs SUPPLY, so this composition recruits Vendors rather
 * than apologising, and leads with the blog corpus as the thing of
 * genuine value that already exists.
 *
 * Deliberately absent versus the live composition:
 *   - the hero search bar — every query returns zero results pre-launch,
 *     and it would compete with Vendor recruitment for the focal point;
 *   - the six destination tiles — they survive an empty database via the
 *     registry fallback in lib/home/queries, but each links to a
 *     guaranteed zero-result /search?region=…, i.e. six confident links
 *     to nothing;
 *   - the featured Experience rail — nothing to render.
 *
 * This lives in its own file so app/[locale]/(marketing)/page.tsx keeps
 * the live composition inline and unchanged: four unit tests read that
 * file as source text and pin its <h1> count, section ordering, and
 * that <HomeTrust /> closes <main>.
 */

interface PreLaunchHomeProps {
  locale: string
  posts: BlogPostListItem[]
}

export async function PreLaunchHome({
  locale,
  posts,
}: PreLaunchHomeProps): Promise<ReactElement> {
  const t = await getTranslations({ locale, namespace: 'HomePage.preLaunch' })

  return (
    <main className="flex flex-col">
      {/* ── Honest pre-launch hero: states the situation, then recruits ── */}
      <section className="border-b border-border bg-surface-1">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center md:py-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t('eyebrow')}
          </span>
          <h1 className="font-heading text-h1 font-bold tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="max-w-2xl text-base text-muted-foreground md:text-lg">
            {t('subtitle')}
          </p>
        </div>
      </section>

      {/* ── Primary call to action: Vendor recruitment ─────────────────── */}
      <section
        aria-labelledby="prelaunch-vendor-heading"
        className="border-b border-border"
      >
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-4 px-4 py-14 md:py-16">
          <h2
            id="prelaunch-vendor-heading"
            className="font-heading text-h2 font-bold tracking-tight text-foreground"
          >
            {t('vendorHeading')}
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground">
            {t('vendorBody')}
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/vendor/onboarding"
              className={buttonVariants({ size: 'lg', className: 'min-tap gap-2' })}
            >
              {t('vendorCta')}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/vendor-partner"
              className={buttonVariants({
                variant: 'outline',
                size: 'lg',
                className: 'min-tap',
              })}
            >
              {t('vendorSecondaryCta')}
            </Link>
          </div>
        </div>
      </section>

      {/* ── Honest launching-soon band, in place of the Experience rails ─ */}
      <section aria-labelledby="prelaunch-coming-soon-heading" className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-4 py-12 text-center">
          <Compass className="size-6 text-muted-foreground" aria-hidden="true" />
          <h2
            id="prelaunch-coming-soon-heading"
            className="font-heading text-h3 font-semibold tracking-tight text-foreground"
          >
            {t('comingSoonHeading')}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">{t('comingSoonBody')}</p>
        </div>
      </section>

      {/* ── The blog corpus leads while there is no inventory ──────────── */}
      {posts.length > 0 && (
        <section aria-labelledby="prelaunch-blog-heading" className="border-b border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-14 md:py-16">
            <div className="flex flex-col gap-2">
              <h2
                id="prelaunch-blog-heading"
                className="font-heading text-h2 font-bold tracking-tight text-foreground"
              >
                {t('blogHeading')}
              </h2>
              <p className="max-w-2xl text-base text-muted-foreground">{t('blogBody')}</p>
            </div>

            <div className="grid grid-cols-1 gap-[var(--space-grid-gap)] md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <BlogPostCard
                  key={post.slug}
                  post={post}
                  locale={locale}
                  headingLevel="h3"
                />
              ))}
            </div>

            <div>
              <Link
                href="/blog"
                className={buttonVariants({
                  variant: 'outline',
                  className: 'min-tap gap-2',
                })}
              >
                {t('blogCta')}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      )}

      <HomeHowItWorks />
      <HomeTrust />
    </main>
  )
}
