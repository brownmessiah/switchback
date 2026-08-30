import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  BlogPostsTable,
  type BlogPostTableRow,
} from '@/app/admin/blog/blog-posts-table'

afterEach(() => {
  cleanup()
})

// #106 blog CMS redesign to DESIGN.md §4 A3 (variant A "Operations Console"),
// migrated to the shared ResponsiveTable (ADR-0018 / DESIGN.md §8.5):
//  - the post status (draft / published) is a semantic AdminStatusBadge —
//    status color PAIRED WITH an icon, never color alone (DESIGN.md §1.3 / §5).
//  - a cover-image indicator tells the operator at a glance whether a post has
//    a cover image, without leaking the raw URL into the dense row.
//  - the E2E row hook `tr[data-blog-post-id="…"]` is preserved so the #27
//    CRUD spec keeps matching rows by id.
//
// NOTE: ResponsiveTable renders BOTH the `≥ md` Table and the `< md` Card stack
// at once (a CSS swap, not conditional mounting), so jsdom sees both. Assertions
// that need a single match scope to the `≥ md` Table via `screen.getByRole`.

const ROWS: BlogPostTableRow[] = [
  {
    id: 'post-published',
    title: 'Top 10 Rafting Spots',
    slug: 'top-10-rafting-spots',
    content: '# Body',
    excerpt: 'A summary',
    category: 'guides',
    coverImageUrl: 'https://cdn.example.com/uploads/blog/cover.png',
    status: 'published',
    publishedAt: new Date('2026-05-01T10:00:00Z'),
    authorAdminId: 'admin-1',
    createdAt: new Date('2026-04-28T10:00:00Z'),
    updatedAt: new Date('2026-05-01T10:00:00Z'),
    authorEmail: 'editor@switchback.test',
    authorName: 'Editor',
  },
  {
    id: 'post-draft',
    title: 'Hidden Himalayan Treks',
    slug: 'hidden-himalayan-treks',
    content: '# Body',
    excerpt: null,
    category: 'destinations',
    coverImageUrl: null,
    status: 'draft',
    publishedAt: null,
    authorAdminId: 'admin-1',
    createdAt: new Date('2026-04-30T10:00:00Z'),
    updatedAt: new Date('2026-04-30T10:00:00Z'),
    authorEmail: 'editor@switchback.test',
    authorName: 'Editor',
  },
]

/** The `≥ md` Table rendering — where the E2E `tr` selectors resolve. */
function table(): HTMLElement {
  return screen.getByRole('table')
}

describe('BlogPostsTable (A3, variant A, ResponsiveTable)', () => {
  it('preserves the per-row data-blog-post-id hook used by the #27 E2E', () => {
    render(<BlogPostsTable posts={ROWS} emptyMessage="No blog posts yet." />)
    expect(
      table().querySelector('tr[data-blog-post-id="post-published"]'),
    ).not.toBeNull()
  })

  it('maps a published post to a semantic status badge (success token + icon, never color alone)', () => {
    render(<BlogPostsTable posts={ROWS} emptyMessage="No blog posts yet." />)
    const row = within(table())
      .getByText('Top 10 Rafting Spots')
      .closest('tr') as HTMLElement
    const badge = within(row)
      .getByText('Published')
      .closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    expect(badge!.className).toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('maps a draft post to a neutral status badge paired with an icon (not success)', () => {
    render(<BlogPostsTable posts={ROWS} emptyMessage="No blog posts yet." />)
    const row = within(table())
      .getByText('Hidden Himalayan Treks')
      .closest('tr') as HTMLElement
    const badge = within(row).getByText('Draft').closest('[data-slot="badge"]')
    expect(badge).not.toBeNull()
    // a draft is not published → must NOT use the success/published token
    expect(badge!.className).not.toContain('text-success')
    expect(badge!.querySelector('svg')).not.toBeNull()
  })

  it('shows a cover-image indicator on a post that has a cover and a no-cover marker otherwise', () => {
    render(<BlogPostsTable posts={ROWS} emptyMessage="No blog posts yet." />)
    const withCover = within(table())
      .getByText('Top 10 Rafting Spots')
      .closest('tr') as HTMLElement
    const withoutCover = within(table())
      .getByText('Hidden Himalayan Treks')
      .closest('tr') as HTMLElement
    expect(
      within(withCover).getByTestId('blog-cover-indicator'),
    ).toHaveAttribute('data-has-cover', 'true')
    expect(
      within(withoutCover).getByTestId('blog-cover-indicator'),
    ).toHaveAttribute('data-has-cover', 'false')
  })

  it('renders an empty state when there are no posts', () => {
    render(<BlogPostsTable posts={[]} emptyMessage="No blog posts yet." />)
    expect(screen.getAllByText('No blog posts yet.').length).toBeGreaterThan(0)
  })
})
