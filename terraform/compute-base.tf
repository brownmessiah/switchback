# Compute foundation (ADR-0019): runtime SA + its grants + Artifact Registry.
# The Cloud Run services + migrate Job live in compute-run.tf, applied AFTER the
# secret versions exist (#14) so they can boot.

resource "google_service_account" "runtime" {
  account_id   = "outvers-run"
  display_name = "Cloud Run runtime SA"
}

# Connect to Cloud SQL (private IP; cloudsql.client is harmless/future-proof for IAM auth).
resource "google_project_iam_member" "runtime_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

# Read/write the public uploads bucket (image uploads → GCS).
resource "google_storage_bucket_iam_member" "runtime_uploads_admin" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

# Docker image repository (the deploy pipeline pushes here).
resource "google_artifact_registry_repository" "app" {
  repository_id = "outvers"
  location      = var.region
  format        = "DOCKER"
  description   = "outvers-next application images"
}
