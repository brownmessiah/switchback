// ── Pure utility ─────────────────────────────────────────────────

/**
 * Compute average rating from an array of rating numbers.
 * Returns 0 when the input is empty. Rounds to one decimal place.
 */
export function computeAverageRating(ratings: number[]): number {
  if (ratings.length === 0) return 0
  const sum = ratings.reduce((acc, r) => acc + r, 0)
  return Math.round((sum / ratings.length) * 10) / 10
}
