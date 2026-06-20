# Public uploads bucket (ADR-0019) — uniform bucket-level access, world-readable
# objects via IAM (no per-object ACLs). getUrl() →
# https://storage.googleapis.com/<bucket>/<key>. The Cloud Run runtime SA is
# granted objectAdmin in compute.tf (#10). Sensitive docs (KYC/invoices/payout
# statements) are a SEPARATE private bucket + signed URLs (future M3) — never here.

resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = true # demo phase

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "uploads_public_read" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}
