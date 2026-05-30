import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BlogPostActionsCell } from '@/app/admin/blog/blog-post-actions-cell'

// #106 blog CMS redesign to DESIGN.md §4 A4: the destructive DELETE is
// consequential, so it must NOT fire inline from a bare button + window.confirm.
// It is gated behind a token-true confirm Dialog that restates the destructive
// effect; the underlying deleteBlogPost action fires ONLY after the explicit
// Confirm control inside the Dialog. Cancel is the non-default focus.
//
// We mock the Server Actions so the cell can be unit-tested in isolation.

type Result = { ok: true } | { ok: false; error: string }

const deleteBlogPost = vi.fn(async (_id: string): Promise<Result> => ({ ok: true }))
const updateBlogPost = vi.fn(
  async (_input: unknown): Promise<Result> => ({ ok: true }),
)
const uploadBlogCoverImage = vi.fn(
  async (_fd: unknown): Promise<{ ok: true; asset: { url: string } }> => ({
    ok: true,
    asset: { url: '/uploads/blog/x.png' },
  }),
)

vi.mock('@/app/admin/blog/actions', () => ({
  deleteBlogPost: (id: string) => deleteBlogPost(id),
  updateBlogPost: (input: unknown) => updateBlogPost(input as never),
  uploadBlogCoverImage: (fd: unknown) => uploadBlogCoverImage(fd as never),
}))

const POST_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function renderCell() {
  return render(
    <BlogPostActionsCell
      id={POST_ID}
      title="Top 10 Rafting Spots"
      content="# Body"
      excerpt={null}
      category="guides"
      coverImageUrl={null}
      status="draft"
    />,
  )
}

beforeEach(() => {
  deleteBlogPost.mockClear()
  updateBlogPost.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('BlogPostActionsCell — destructive delete behind a confirm Dialog', () => {
  it('clicking Delete opens a confirm Dialog and does NOT fire the delete inline', async () => {
    const user = userEvent.setup()
    renderCell()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteBlogPost).not.toHaveBeenCalled()

    const dialog = screen.getByTestId('blog-delete-confirm')
    expect(dialog).toBeInTheDocument()
    // the confirm restates the destructive effect + names the post
    expect(dialog.textContent).toMatch(/Top 10 Rafting Spots/)
    expect(dialog.textContent).toMatch(/delete|permanent/i)
  })

  it('fires deleteBlogPost only after the explicit Confirm control is clicked', async () => {
    const user = userEvent.setup()
    renderCell()

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByTestId('blog-delete-confirm')

    await user.click(within(dialog).getByRole('button', { name: 'Delete post' }))
    expect(deleteBlogPost).toHaveBeenCalledWith(POST_ID)
  })
})
