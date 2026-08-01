# Cloud Run services + migrate Job (ADR-0019). Applied AFTER #14 populates secret
# versions (a secret env ref to a versionless secret blocks instance start).
# Created with a placeholder image; the CI pipeline pushes the real image and the
# image field is lifecycle-ignored so deploys don't fight Terraform.

locals {
  secret_env_keys = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "CRON_SECRET",
    "RAZORPAY_KEY_ID",
    "RAZORPAY_KEY_SECRET",
    "RAZORPAYX_WEBHOOK_SECRET",
    # NOTE — the following are NOT listed yet ON PURPOSE. A secret env ref to a
    # VERSIONLESS secret blocks Cloud Run from starting (see the header of
    # secrets.tf), so each is a two-step owner task:
    #   1. Create the secret version out-of-band:
    #      printf %s "$VALUE" | gcloud secrets versions add <NAME> --data-file=-
    #   2. Add <NAME> to this list AND to local.secret_ids, then apply.
    #
    #   "RESEND_API_KEY"      — transactional email (vendor welcome + KYC
    #                           decision). Until wired, getEmailSender()
    #                           reports a hard failure in production rather
    #                           than silently pretending to deliver.
    #   "GOOGLE_CLIENT_SECRET" — Google sign-in. Until wired, the button is
    #                           present but better-auth rejects the flow and
    #                           the error is surfaced to the user.
  ]
  web_plain_env = {
    NEXT_PUBLIC_APP_URL = var.app_url
    RAZORPAY_TEST_MODE  = "true"
    GCS_BUCKET          = google_storage_bucket.uploads.name
    # PRIVATE bucket for KYC documents. Never falls back to GCS_BUCKET — that
    # one is world-readable (see lib/storage/private-factory.ts).
    GCS_KYC_BUCKET  = google_storage_bucket.kyc.name
    STORAGE_BACKEND = "gcs"
    # Google sign-in. The client ID is public by design (it ships in the OAuth
    # redirect); only GOOGLE_CLIENT_SECRET is a secret, and it is pending the
    # two-step activation noted above.
    GOOGLE_CLIENT_ID = var.google_client_id
    # Envelope sender; must be on a Resend-verified domain (SPF/DKIM).
    EMAIL_FROM = var.email_from
  }
  cron_plain_env = merge(local.web_plain_env, { RUN_CRON_ROUTES = "true" })
}

# ---- Public web service ----------------------------------------------------
resource "google_cloud_run_v2_service" "web" {
  name                = "outvers-web"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 80
    # Scale to zero when idle. A warm floor (min=1) bills a full instance 24/7 —
    # the single largest Cloud Run line — and buys nothing while traffic is
    # near-zero. Cold starts return to the critical path; startup_cpu_boost below
    # keeps them short.
    scaling {
      min_instance_count = 0
      max_instance_count = 4
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc_v2.id
        subnetwork = google_compute_subnetwork.main_v2.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # Request-based billing: CPU is throttled outside a request, so an
        # instance that is alive but idle bills nothing. Left unset this defaults
        # to always-allocated (instance-based) billing — 1 vCPU charged around the
        # clock. This plus min=0 is what takes idle spend to ~zero.
        cpu_idle = true
        # min=0 puts cold starts on the user path; boost CPU during startup so the
        # deep /api/healthz probe (which dials Cloud SQL) clears quickly.
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.web_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.secret_env_keys)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      # Deep startup probe → an instance only takes traffic once Cloud SQL is
      # reachable. No explicit liveness probe → Cloud Run's default (process-up)
      # liveness, so a transient DB blip never restart-loops every instance.
      startup_probe {
        http_get {
          path = "/api/healthz"
          port = 8080
        }
        initial_delay_seconds = 5
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 18
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---- Private cron service (OIDC-only; invoker bound in scheduler.tf) --------
resource "google_cloud_run_v2_service" "cron" {
  name                = "outvers-cron"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc_v2.id
        subnetwork = google_compute_subnetwork.main_v2.id
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.placeholder_image
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        # Matters more here than it looks: partial-pay-autocapture fires every 15
        # min, and an instance lingers after each request. Under always-allocated
        # billing that lingering adds up to near-continuous CPU charges for a
        # service that does a few seconds of real work per hour.
        cpu_idle          = true
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.cron_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = toset(local.secret_env_keys)
        content {
          name = env.value
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/api/healthz"
          port = 8080
        }
        initial_delay_seconds = 5
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 18
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}

# ---- Migrate Cloud Run Job (alternate entrypoint, in-VPC) -------------------
resource "google_cloud_run_v2_job" "migrate" {
  name                = "outvers-migrate"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.runtime.email
      max_retries     = 1
      vpc_access {
        network_interfaces {
          network    = google_compute_network.vpc_v2.id
          subnetwork = google_compute_subnetwork.main_v2.id
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
      containers {
        image = var.placeholder_image
        # args (NOT command): keep the distroless `node` ENTRYPOINT and pass the
        # bundled runner as its arg → `node migrate.cjs`. Cloud Run v2 `command`
        # REPLACES the entrypoint, which would try to exec the non-executable .cjs.
        args = ["migrate.cjs"]
        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = "DATABASE_URL"
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].template[0].containers[0].image,
      client,
      client_version,
    ]
  }
}
