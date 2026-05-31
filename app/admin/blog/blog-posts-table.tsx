import { ImageIcon, ImageOffIcon } from 'lucide-react'

import { AdminStatusBadge } from '@/app/admin/_components/admin-status-badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

/**
 * Blog posts as a DESIGN.md §4 A3 data table (variant A "Operations Console"):
 * `Card > CardContent p-0 > Table` in a horizontal-scroll region, an
 * sr-only caption, `scope="col"` heads, hover rows, and a semantic
 * `AdminStatusBadge` for the draft/published status (color + icon, never color
 * alone). The per-row `data-blog-post-id` hook is preserved for the #27 E2E.
 */
export function BlogPostsTable({ posts, emptyMessage }: BlogPostsTableProps) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">
              Blog posts with status, cover image, author and CRUD actions
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Title</TableHead>
                <TableHead scope="col">Slug</TableHead>
                <TableHead scope="col">Category</TableHead>
                <TableHead scope="col">Cover</TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Published</TableHead>
                <TableHead scope="col">Author</TableHead>
                <TableHead scope="col">Created</TableHead>
                <TableHead scope="col" className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-8 text-center text-muted-foreground"
                  >
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                posts.map((p) => (
                  <TableRow
                    key={p.id}
                    data-blog-post-id={p.id}
                    className="hover:bg-muted/50"
                  >
                    <TableCell className="max-w-[200px] truncate text-sm font-medium">
                      {p.title}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate font-mono text-sm text-muted-foreground">
                      {p.slug}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {capitalize(p.category)}
                    </TableCell>
                    <TableCell>
                      <CoverIndicator url={p.coverImageUrl} />
                    </TableCell>
                    <TableCell>
                      <AdminStatusBadge
                        status={p.status}
                        label={STATUS_LABELS[p.status] ?? capitalize(p.status)}
                      />
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {formatDate(p.publishedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.authorEmail ?? p.authorName ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {formatDate(p.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <BlogPostActionsCell
                        id={p.id}
                        title={p.title}
                        content={p.content}
                        excerpt={p.excerpt}
                        category={p.category}
                        coverImageUrl={p.coverImageUrl}
                        status={p.status}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
