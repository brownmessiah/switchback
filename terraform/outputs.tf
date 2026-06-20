output "deployer_sa_email" {
  value       = google_service_account.deployer.email
  description = "Service account GitHub Actions impersonates via WIF"
}

output "wif_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "Full WIF provider resource name for the google-github-actions/auth step"
}
