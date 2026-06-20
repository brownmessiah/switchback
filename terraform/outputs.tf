output "deployer_sa_email" {
  value       = google_service_account.deployer.email
  description = "Service account GitHub Actions impersonates via WIF"
}

output "wif_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Full WIF provider resource name for the google-github-actions/auth step"
}

output "sql_private_ip" {
  value       = google_sql_database_instance.main.private_ip_address
  description = "Cloud SQL private IP — host for DATABASE_URL"
}

output "sql_connection_name" {
  value       = google_sql_database_instance.main.connection_name
  description = "Cloud SQL instance connection name (project:region:instance)"
}

output "uploads_bucket" {
  value       = google_storage_bucket.uploads.name
  description = "Public uploads bucket name (GCS_BUCKET)"
}

output "vpc_network" {
  value = google_compute_network.vpc.id
}

output "subnet" {
  value = google_compute_subnetwork.main.id
}
