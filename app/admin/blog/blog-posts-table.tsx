import { ImageIcon, ImageOffIcon } from 'lucide-react'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import {
  ResponsiveTable,
  type ResponsiveTableColumn,
} from '@/components/ui/responsive-table'

import { BlogPostActionsCell } from './blog-post-actions-cell'

// ── Row shape ──────────────────────────────────────────────────────

export interface BlogPostTableRow {
  id: string
  title: string
  slug: string
  content: string
  excerpt: string | null
  category: string
  coverImageUrl: string | null
  status: string
  publishedAt: Date | null
  authorAdminId: string
  createdAt: Date
  updatedAt: Date
  authorEmail: string | null
  authorName: string | null
}

// ── Helpers ────────────────────────────────────────────────────────

function formatDate(d: Date | null): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Human label for the post status cell. */
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
}

// ── Cover-image indicator ──────────────────────────────────────────

/**
 * At-a-glance cover-image indicator: a filled image icon when the post has a
 * cover, a muted "off" icon otherwise. The raw URL is intentionally NOT leaked
 * into the dense A3 row (it lives in the edit form). `data-has-cover` lets the
 * operator (and tests) read the boolean directly.
 */
function CoverIndicator({ url }: { url: string | null }) {
  const hasCover = Boolean(url)
  return (
    <span
      data-testid="blog-cover-indicator"
      data-has-cover={hasCover ? 'true' : 'false'}
      className={
        hasCover ? 'inline-flex text-success' : 'inline-flex text-muted-foreground'
      }
      aria-label={hasCover ? 'Has cover image' : 'No cover image'}
    >
      {hasCover ? (
        <ImageIcon aria-hidden className="size-4" />
      ) : (
        <ImageOffIcon aria-hidden className="size-4" />
      )}
    </span>
  )
}

// ── Table (A3) ─────────────────────────────────────────────────────

interface BlogPostsTableProps {
  posts: BlogPostTableRow[]
  emptyMessage: string
}

const COLUMNS: ResponsiveTableColumn<BlogPostTableRow>[] = [
  {
    key: 'title',
    header: 'Title',
    primary: true,
    cell: (p) => <span className="font-medium">{p.title}</span>,
  },
  {
    key: 'slug',
    header: 'Slug',
    cell: (p) => (
      <span className="font-mono text-sm text-muted-foreground">{p.slug}</span>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    cell: (p) => (
      <span className="text-muted-foreground">{capitalize(p.category)}</span>
    ),
  },
  {
    key: 'cover',
    header: 'Cover',
    cell: (p) => <CoverIndicator url={p.coverImageUrl} />,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (p) => (
      <AdminStatusBadge
        status={p.status}
        label={STATUS_LABELS[p.status] ?? capitalize(p.status)}
      />
    ),
  },
  {
    key: 'published',
    header: 'Published',
    cell: (p) => (
      <span className="tabular-nums text-muted-foreground">
        {formatDate(p.publishedAt)}
      </span>
    ),
  },
  {
    key: 'author',
    header: 'Author',
    cell: (p) => (
      <span className="text-muted-foreground">
        {p.authorEmail ?? p.authorName ?? '—'}
      </span>
    ),
  },
  {
    key: 'created',
    header: 'Created',
    cell: (p) => (
      <span className="tabular-nums text-muted-foreground">
        {formatDate(p.createdAt)}
      </span>
    ),
  },
  {
    key: 'actions',
    header: 'Actions',
    align: 'right',
    cell: (p) => (
      <BlogPostActionsCell
        id={p.id}
        title={p.title}
        content={p.content}
        excerpt={p.excerpt}
        category={p.category}
        coverImageUrl={p.coverImageUrl}
        status={p.status}
      />
    ),
  },
]

/**
 * Blog posts as a DESIGN.md §4 A3 data table (variant A "Operations Console"),
 * migrated to the shared `ResponsiveTable` (ADR-0018 / DESIGN.md §8.5): the
 * `≥ md` Table reverses to a stacked label:value Card list `< md`. Status is a
 * semantic `AdminStatusBadge` (color + icon, never color alone). The per-row
 * `data-blog-post-id` hook is preserved for the #27 E2E.
 */
export function BlogPostsTable({ posts, emptyMessage }: BlogPostsTableProps) {
  return (
    <ResponsiveTable<BlogPostTableRow>
      columns={COLUMNS}
      rows={posts}
      getRowKey={(p) => p.id}
      rowProps={(p) => ({ 'data-blog-post-id': p.id })}
      caption="Blog posts with status, cover image, author and CRUD actions"
      empty={emptyMessage}
    />
  )
}
