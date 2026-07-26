import Image from 'next/image'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import type { BlogPostListItem } from '@/lib/blog/queries'

/**
 * Blog post card, shared by the /blog index and the pre-launch home
 * (launch-readiness 04). Extracted rather than duplicated so the two
 * surfaces cannot drift.
 *
 * `headingLevel` exists because the home page already spends its single
 * <h1> on the hero — a card grid nested under an <h2> section heading
 * must not emit <h2>s of its own.
 */

export function formatBlogDate(date: Date | null, locale: string): string {
  if (!date) return ''
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date)
}

interface BlogPostCardProps {
  post: BlogPostListItem
  locale: string
  headingLevel?: 'h2' | 'h3'
}

export function BlogPostCard({
  post,
  locale,
  headingLevel = 'h2',
}: BlogPostCardProps) {
  const Heading = headingLevel

  return (
    <Link
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
    >
      {post.coverImageUrl && (
        <div className="relative aspect-[3/2] w-full overflow-hidden">
          <Image
            src={post.coverImageUrl}
            alt=""
            role="presentation"
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-[var(--space-card-pad)]">
        <Badge variant="secondary" className="self-start capitalize">
          {post.category}
        </Badge>
        <Heading className="line-clamp-2 font-heading text-base font-semibold leading-snug tracking-tight">
          {post.title}
        </Heading>
        {post.excerpt && (
          <p className="line-clamp-3 text-sm text-muted-foreground">{post.excerpt}</p>
        )}
        <time
          className="mt-auto pt-1 text-xs text-muted-foreground"
          dateTime={post.publishedAt?.toISOString()}
        >
          {formatBlogDate(post.publishedAt, locale)}
        </time>
      </div>
    </Link>
  )
}
