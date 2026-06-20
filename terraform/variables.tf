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
  # First deploy: the assigned Cloud Run web URL (pre-DNS validation runs here).
  # Flips to https://outvers.com at the domain step (#16).
  default = "https://outvers-web-vcmczhad2a-el.a.run.app"
}
