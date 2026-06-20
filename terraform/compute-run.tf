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
  ]
  web_plain_env = {
    NEXT_PUBLIC_APP_URL = var.app_url
    RAZORPAY_TEST_MODE  = "true"
    GCS_BUCKET          = google_storage_bucket.uploads.name
    STORAGE_BACKEND     = "gcs"
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
    scaling {
      min_instance_count = 1
      max_instance_count = 4
    }
    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
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
        network    = google_compute_network.vpc.id
        subnetwork = google_compute_subnetwork.main.id
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
          network    = google_compute_network.vpc.id
          subnetwork = google_compute_subnetwork.main.id
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
