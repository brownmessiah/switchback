# Secret Manager containers (ADR-0019). Terraform owns the CONTAINERS + IAM only;
# VALUES are added out-of-band (#14) so no plaintext ever enters tf state or git.
# Only secrets that WILL have a version are listed here — Cloud Run fails to boot
# on a secret env ref to a versionless secret, so this set must match #14.

locals {
  secret_ids = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "CRON_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    # Required by app/api/webhooks/razorpay: without it the handler returns 500
    # BEFORE signature verification, so a Customer who has actually paid never
    # gets their Booking confirmed. Per the header note above, its VERSION must
    # be added out-of-band BEFORE this is applied — Cloud Run will not boot on a
    # secret env ref to a versionless secret.
    "RAZORPAY_WEBHOOK_SECRET",
    "RAZORPAYX_WEBHOOK_SECRET",
  ]
}

resource "google_secret_manager_secret" "app" {
  for_each  = toset(local.secret_ids)
  secret_id = each.value
  replication {
    auto {}
  }
}

# The Cloud Run runtime SA may read each secret's versions (mounted env refs).
resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
