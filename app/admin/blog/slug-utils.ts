/**
 * Generate a URL-safe slug from a title.
 * - Lowercases, strips non-alphanumeric (except spaces/hyphens),
 *   collapses consecutive hyphens, trims leading/trailing hyphens.
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
