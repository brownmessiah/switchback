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

# ---- PRIVATE KYC bucket -----------------------------------------------------
# Vendor identity documents (Aadhaar, PAN, government ID, selfie). Sensitive
# personal identifiers, so this bucket deliberately has NO `allUsers` IAM
# binding — objects are unreachable without credentials and are served to
# admins only through short-lived v4 signed URLs (lib/storage/gcs-private.ts).
#
# Kept as a separate bucket rather than a prefix on `uploads`: that bucket is
# world-readable at the bucket level, so no prefix within it can be private.
#
# force_destroy is FALSE here even in the demo phase — unlike listing photos,
# these cannot be re-uploaded on a whim and their loss is a compliance problem.
resource "google_storage_bucket" "kyc" {
  name                        = "${var.project_id}-kyc"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  # No CORS: documents are fetched by the browser from a signed URL on the
  # storage host directly, never cross-origin from the app.

  versioning {
    enabled = true
  }

  # Identity documents are retained only as long as they are needed to support
  # the verification decision; 3 years covers the audit window.
  lifecycle_rule {
    condition {
      age = 1095
    }
    action {
      type = "Delete"
    }
  }
}

# The Cloud Run runtime SA reads/writes KYC objects and signs URLs for them.
resource "google_storage_bucket_iam_member" "kyc_runtime_access" {
  bucket = google_storage_bucket.kyc.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}
