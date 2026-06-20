locals {
  services = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "cloudbilling.googleapis.com",
    "certificatemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "iam.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudresourcemanager.googleapis.com",
  ]
}

# Tracked for reproducibility (a fresh project from this module enables them).
# Already enabled out-of-band, so apply is a no-op. Never disable on destroy.
resource "google_project_service" "enabled" {
  for_each                   = toset(local.services)
  service                    = each.value
  disable_on_destroy         = false
  disable_dependent_services = false
}
