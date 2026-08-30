# Cloud SQL for PostgreSQL 16 — zonal, private-IP-only, daily backups + 7-day
# PITR (ADR-0019). The app DB user + password are created OUT-OF-BAND (#14) and
# stored straight in Secret Manager, so no DB secret ever lands in tf state.

resource "google_sql_database_instance" "main" {
  name                = "${var.resource_prefix}-pg"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = false # demo phase — allow teardown

  # v2 network — the original outvers-vpc is broken (see network.tf header).
  # The instance was migrated with `gcloud sql instances patch --network=...` on
  # 2026-07-31; its private IP moved 10.140.0.3 -> 10.150.0.3 and the
  # DATABASE_URL secret was updated to match (version 2).
  depends_on = [google_service_networking_connection.private_vpc_v2]

  settings {
    tier              = "db-custom-1-3840" # 1 vCPU / 3.75 GB
    availability_type = "ZONAL"
    edition           = "ENTERPRISE"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "18:30" # 00:00 IST
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false # no public IP — ADR-0019 private-IP-only holds
      private_network = google_compute_network.vpc_v2.id
    }
  }
}

# Application database. pg_trgm is created by migration 0034 at first migrate.
resource "google_sql_database" "app" {
  name     = var.resource_prefix
  instance = google_sql_database_instance.main.name
}
