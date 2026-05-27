export default function VendorReviewsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View and respond to customer reviews.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border py-16 text-center">
        <p className="text-lg font-medium">No reviews yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Reviews will appear here once customers leave feedback on your experiences.
        </p>
      </div>
    </div>
  )
}
