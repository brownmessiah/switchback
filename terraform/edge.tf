# Global External Application LB + Serverless NEG + Cloud CDN + managed cert
# (ADR-0019). Cloud Armor is DEFERRED to the real-money cutover (no policy here).
# The managed cert provisions once DNS points at the static IP (#16); pre-DNS,
# validation runs against the Cloud Run URL.

resource "google_compute_global_address" "lb_ip" {
  name = "outvers-lb-ip"
}

resource "google_compute_region_network_endpoint_group" "web_neg" {
  name                  = "outvers-web-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }
}

resource "google_compute_backend_service" "web" {
  name                  = "outvers-web-backend"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  enable_cdn            = true

  # Respect the app's Cache-Control: never cache authed responses, Server Actions,
  # or API routes (Next emits private/no-store on those); cache /_next/static,
  # /_next/image and public/ISR pages where the app marks them cacheable.
  cdn_policy {
    cache_mode = "USE_ORIGIN_HEADERS"
    cache_key_policy {
      include_host         = true
      include_protocol     = true
      include_query_string = true
    }
  }

  backend {
    group = google_compute_region_network_endpoint_group.web_neg.id
  }
}

resource "google_compute_url_map" "web" {
  name            = "outvers-urlmap"
  default_service = google_compute_backend_service.web.id
}

# The live proxy serves `outvers-cert-2`: the original `outvers-cert` stuck in
# FAILED_NOT_VISIBLE during the domain cutover and was recreated under a new
# name, but the rename was never codified. While this said `outvers-cert`, ANY
# apply — including one fixing something unrelated — would swap the live proxy
# back to a certificate that no longer serves, taking TLS down on the apex
# domain. prevent_destroy makes that failure mode loud instead of silent.
resource "google_compute_managed_ssl_certificate" "web" {
  name = "outvers-cert-2"
  managed {
    domains = [var.domain, "www.${var.domain}"]
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "google_compute_target_https_proxy" "web" {
  name             = "outvers-https-proxy"
  url_map          = google_compute_url_map.web.id
  ssl_certificates = [google_compute_managed_ssl_certificate.web.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "outvers-https-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.web.id
  port_range            = "443"
  ip_address            = google_compute_global_address.lb_ip.id
}

# Port 80 → 301 to HTTPS.
resource "google_compute_url_map" "http_redirect" {
  name = "outvers-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "web" {
  name    = "outvers-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http" {
  name                  = "outvers-http-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.web.id
  port_range            = "80"
  ip_address            = google_compute_global_address.lb_ip.id
}
