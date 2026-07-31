# VPC for the private data tier + Cloud Run Direct VPC egress (ADR-0019).
# No Cloud NAT / Serverless VPC connector — Cloud Run uses Direct VPC egress with
# private-ranges-only egress; external SaaS calls go straight out.
#
# ⚠️  TWO VPCs LIVE HERE. Read this before changing anything below.
#
# `outvers-vpc` (the original, resources named `vpc` / `main` / `private_ip_range`
# / `private_vpc`) was BROKEN by the 2026-07-31 billing suspension + restore. The
# GCP backend reports it as "not ready": subnets cannot be created in it, and
# Cloud Run Direct VPC egress fails every network-interface allocation with
# gRPC code 13 (INTERNAL). Google's own API classifies it as a Google-side fault.
# See .scratch/gcp-vpc-incident/SUPPORT-CASE.md — a support case is open/pending.
#
# `outvers-vpc-v2` (resources suffixed `_v2`) is the REPLACEMENT and is what
# actually serves traffic. Cloud SQL and both Cloud Run services were migrated to
# it on 2026-07-31. A healthy VPC in this same project accepted a Direct VPC
# egress attachment in 7.5s, which is how the fault was isolated to the old VPC.
#
# The old resources are deliberately KEPT in config+state so Terraform does not
# try to delete them while Google investigates. Do NOT point workloads back at
# them until Google confirms the "not ready" state is cleared.

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

# ---------------------------------------------------------------------------
# v2 network — the one that actually serves traffic. See header note.
# ---------------------------------------------------------------------------

resource "google_compute_network" "vpc_v2" {
  name                    = "outvers-vpc-v2"
  auto_create_subnetworks = false
}

# Same /24 rationale as the original subnet: Direct VPC egress reserves /28
# blocks and holds them after scale-down, so a /28 subnet fails to deploy.
resource "google_compute_subnetwork" "main_v2" {
  name                     = "outvers-subnet-v2"
  ip_cidr_range            = "10.11.0.0/24"
  region                   = var.region
  network                  = google_compute_network.vpc_v2.id
  private_ip_google_access = true
}

# PSA range for the v2 network. 10.150.0.0/16 — deliberately disjoint from the
# original 10.140.0.0/16 so both can coexist while the old VPC is being repaired.
resource "google_compute_global_address" "private_ip_range_v2" {
  name          = "outvers-psa-range-v2"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  address       = "10.150.0.0"
  network       = google_compute_network.vpc_v2.id
}

resource "google_service_networking_connection" "private_vpc_v2" {
  network                 = google_compute_network.vpc_v2.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_range_v2.name]
}
