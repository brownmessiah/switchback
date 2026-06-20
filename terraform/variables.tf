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

# Placeholder image used until the GitHub Actions pipeline pushes the first real
# one (Cloud Run requires an image to create a service).
variable "placeholder_image" {
  type    = string
  default = "us-docker.pkg.dev/cloudrun/container/hello"
}
