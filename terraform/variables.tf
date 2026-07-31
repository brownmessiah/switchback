variable "project_id" {
  type    = string
  default = "outvers-adventure"
}

variable "project_number" {
  type    = string
  default = "695802542841"
}

variable "region" {
  type    = string
  default = "asia-south1"
}

variable "github_repo" {
  type        = string
  description = "owner/repo the WIF trust + deploy are scoped to"
  default     = "aishwarye-creator/outvers-next"
}

variable "github_branch" {
  type    = string
  default = "main"
}

variable "domain" {
  type    = string
  default = "outvers.com"
}

variable "alert_email" {
  type        = string
  description = "Email for budget + monitoring alert notifications"
  default     = "aishwarye@outvers.com"
}

variable "billing_account" {
  type    = string
  default = "01A6C8-6EEE44-C29C64"
}

# ---- Cost controls ---------------------------------------------------------

# The budget in ops.tf is off by default so `apply` still succeeds on an identity
# without roles/billing.costsManager on the billing account. Flip to true once the
# grant exists — see the runbook comment above the resource.
variable "enable_billing_budget" {
  type        = bool
  description = "Create the alert-only monthly billing budget (needs billing.costsManager)"
  default     = false
}

variable "monthly_budget_usd" {
  type        = number
  description = "Alert-only monthly budget ceiling; alerts at 50/90/100%"
  default     = 120
}

# The global external ALB + Cloud CDN in edge.tf costs ~$18-25/mo in forwarding
# rules alone before a byte is served. Defaults to true because the live GoDaddy
# apex + www A records point at the LB's static IP — flipping this to false
# without re-pointing DNS first takes outvers.com offline. See edge.tf for the
# Cloud Run domain-mapping alternative and the DNS cutover order.
variable "enable_lb" {
  type        = bool
  description = "Provision the global external ALB + Cloud CDN in front of Cloud Run"
  default     = true
}

# Placeholder image used until the GitHub Actions pipeline pushes the first real
# one (Cloud Run requires an image to create a service).
variable "placeholder_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}

# Public app URL baked into the build + set as the runtime NEXT_PUBLIC_APP_URL.
# Placeholder until the first deploy (#15) reads the assigned Cloud Run URL; flips
# to https://outvers.com at the domain step (#16).
variable "app_url" {
  type = string
  # Domain step (#16) complete: DNS (GoDaddy apex + www) points at the LB and the
  # managed cert serves TLS for outvers.com, so the app is addressed by its real
  # domain. Baked into the client bundle (build-arg) + set as runtime NEXT_PUBLIC_APP_URL.
  default = "https://outvers.com"
}
