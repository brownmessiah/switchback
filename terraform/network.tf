# VPC for the private data tier + Cloud Run Direct VPC egress (ADR-0019).
# No Cloud NAT / Serverless VPC connector — Cloud Run uses Direct VPC egress with
# private-ranges-only egress; external SaaS calls go straight out.

resource "google_compute_network" "vpc" {
  name                    = "outvers-vpc"
  auto_create_subnetworks = false
}

# Dedicated subnet that Cloud Run attaches to for Direct VPC egress. /24 (not the
# ADR's /28 — Cloud Run Direct VPC egress needs far more headroom; /28 fails the
# deploy health check with "no sufficient IP addresses").
resource "google_compute_subnetwork" "main" {
  name                     = "outvers-subnet"
  ip_cidr_range            = "10.10.0.0/24"
  region                   = var.region
  network                  = google_compute_network.vpc.id
  private_ip_google_access = true
}

# Private Services Access — reserved range + VPC peering so Cloud SQL gets a
# private IP (no public IP anywhere on the data tier).
resource "google_compute_global_address" "private_ip_range" {
  name          = "outvers-psa-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range.name]
}
