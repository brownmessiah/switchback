/**
 * Shared filter/sort option vocabulary for the listings index (#75 variant A).
 *
 * Lives in a plain (non-`'use client'`) module so BOTH the Server Component
 * page (for searchParams validation + server-side filter/sort) and the client
 * controls island can import the same source of truth. Exporting these from
 * the `'use client'` island would surface them on the server as client-
 * reference proxies, not real arrays.
 */

export const LISTING_STATUS_FILTERS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'published', label: 'Published' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
] as const

export const LISTING_SORTS = [
  { value: 'created_desc', label: 'Newest first' },
  { value: 'created_asc', label: 'Oldest first' },
  { value: 'title', label: 'Title (A–Z)' },
  { value: 'completeness', label: 'Completeness' },
  { value: 'status', label: 'Status' },
] as const

export type ListingStatusFilter = (typeof LISTING_STATUS_FILTERS)[number]['value']
export type ListingSort = (typeof LISTING_SORTS)[number]['value']
