# Cost guardrail + observability (ADR-0019). Budget is alert-only (no auto-disable
# — that would kill the live demo). Sentry owns app-exception alerting; these are
# the infra alerts: 5xx, Cloud SQL health, and a synthetic uptime check → email.

resource "google_monitoring_notification_channel" "email" {
  display_name = "Outvers ops email"
  type         = "email"
  labels = {
    email_address = var.alert_email
  }
}

# DEFERRED: $120/mo alert-only budget. The deploy identity (aishwarye@outvers.com)
# lacks billing-account permissions on 01A6C8-6EEE44-C29C64 (billing.budgets.create
# → PERMISSION_DENIED), which is a separate grant from project billing-linkage.
# Re-enable once `roles/billing.costsManager` is granted on the billing account:
#
# resource "google_billing_budget" "monthly" {
#   billing_account = var.billing_account
#   display_name    = "outvers-adventure monthly"
#   budget_filter {
#     projects               = ["projects/${var.project_number}"]
#     credit_types_treatment = "INCLUDE_ALL_CREDITS"
#   }
#   amount { specified_amount { currency_code = "USD" units = "120" } }
#   threshold_rules { threshold_percent = 0.5 }
#   threshold_rules { threshold_percent = 0.9 }
#   threshold_rules { threshold_percent = 1.0 }
#   all_updates_rule {
#     monitoring_notification_channels = [google_monitoring_notification_channel.email.id]
#     disable_default_iam_recipients   = false
#   }
# }

# Synthetic uptime check on the public web service (deep healthz → also alerts if
# Cloud SQL is unreachable). Re-targets to outvers.com after the domain is wired.
resource "google_monitoring_uptime_check_config" "web" {
  display_name = "outvers web /api/healthz"
  timeout      = "10s"
  period       = "300s"

  http_check {
    path    = "/api/healthz"
    port    = 443
    use_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.web.uri, "https://")
    }
  }
}

resource "google_monitoring_alert_policy" "web_5xx" {
  display_name = "Web service 5xx rate"
  combiner     = "OR"
  conditions {
    display_name = "outvers-web 5xx"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"outvers-web\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "cron_5xx" {
  display_name = "Cron service failures (5xx)"
  combiner     = "OR"
  conditions {
    display_name = "outvers-cron 5xx"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND resource.labels.service_name = \"outvers-cron\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_RATE"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "sql_down" {
  display_name = "Cloud SQL instance down"
  combiner     = "OR"
  conditions {
    display_name = "database/up < 1"
    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND metric.type = \"cloudsql.googleapis.com/database/up\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MIN"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}

resource "google_monitoring_alert_policy" "sql_disk" {
  display_name = "Cloud SQL disk > 90%"
  combiner     = "OR"
  conditions {
    display_name = "disk/utilization > 0.9"
    condition_threshold {
      filter          = "resource.type = \"cloudsql_database\" AND metric.type = \"cloudsql.googleapis.com/database/disk/utilization\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.9
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_MEAN"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.email.id]
}
