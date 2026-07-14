# Cloud Scheduler ×3 → private cron service via OIDC (ADR-0019), tz Asia/Kolkata.
# The scheduler SA is the cron service's ONLY invoker. The app-level CRON_SECRET
# (defense-in-depth) travels in the X-Cron-Secret header — set OUT-OF-BAND in #14
# (the secret value never enters tf state), so headers are lifecycle-ignored.

resource "google_service_account" "scheduler" {
  account_id   = "outvers-scheduler"
  display_name = "Cloud Scheduler → cron invoker"
}

resource "google_cloud_run_v2_service_iam_member" "cron_invoker" {
  name     = google_cloud_run_v2_service.cron.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  # IST schedules expressed directly (tz = Asia/Kolkata).
  cron_jobs = {
    "partial-pay-autocapture" = "*/15 * * * *"
    "trip-groups-archive"     = "30 3 * * *"
    "payout-batch"            = "0 17 * * *"
    # ADR-0020 launch dependency: rolling ~90-day slot materialization so
    # date-availability search never shrinks for quiet listings.
    "materialize-slots"       = "0 8 * * *"
  }
}

resource "google_cloud_scheduler_job" "cron" {
  for_each  = local.cron_jobs
  name      = "outvers-${each.key}"
  region    = var.region
  schedule  = each.value
  time_zone = "Asia/Kolkata"

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.cron.uri}/api/cron/${each.key}"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = google_cloud_run_v2_service.cron.uri
    }
  }

  retry_config {
    retry_count = 1
  }

  # X-Cron-Secret header added out-of-band in #14 (keeps the secret out of state).
  lifecycle {
    ignore_changes = [http_target[0].headers]
  }
}
