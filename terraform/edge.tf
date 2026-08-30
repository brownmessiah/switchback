# Global External Application LB + Serverless NEG + Cloud CDN + managed cert
# (ADR-0019). Cloud Armor is DEFERRED to the real-money cutover (no policy here).
# The managed cert provisions once DNS points at the static IP (#16); pre-DNS,
# validation runs against the Cloud Run URL.
#
# COST: this stack bills ~$18-25/mo in forwarding-rule + static-IP charges before
# serving a single byte, plus CDN cache-fill and LB data processing. That is real
# money against a ~$15-30/mo target, so every resource here is gated on
# var.enable_lb (default true — see below).
#
# TEARDOWN ORDER (do not reorder — skipping step 1 hard-downs outvers.com):
#   1. Create a Cloud Run domain mapping for outvers.com + www and read back the
#      resource records it asks for:
#        gcloud beta run domain-mappings create --service=outvers-web \
#          --domain=outvers.com --region=asia-south1
#      Apex domains need the 4 A + 4 AAAA records it returns; www takes a CNAME
#      to ghs.googlehosted.com. Confirm domain mapping is offered in asia-south1
#      before committing — it is not available in every Cloud Run region, and if
#      it is not, keep this LB (it is then the only way to serve the apex).
#   2. Re-point the GoDaddy apex + www records at those values and let TTLs expire.
#   3. terraform apply -var enable_lb=false
#
# CERT DRIFT — RESOLVED 2026-07-31. State referenced `outvers-cert`, which had
# been stuck in PROVISIONING_FAILED_PERMANENTLY since 2026-06-20; the live proxy
# actually served `outvers-cert-2` (ACTIVE, created out-of-band 2026-07-08).
# A plan therefore wanted to move ssl_certificates on the HTTPS proxy from the
# working cert to the dead one — which would have broken TLS on outvers.com with
# no self-healing. Fixed by `state rm` + `import` of outvers-cert-2 at this
# address. `outvers-cert` still EXISTS in the project, unmanaged and dead — safe
# to delete once this has been applied and verified:
#   gcloud compute ssl-certificates delete outvers-cert --global

resource "google_compute_global_address" "lb_ip" {
  count = var.enable_lb ? 1 : 0
  name  = "${var.resource_prefix}-lb-ip"
}

resource "google_compute_region_network_endpoint_group" "web_neg" {
  count                 = var.enable_lb ? 1 : 0
  name                  = "${var.resource_prefix}-web-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
  cloud_run {
    service = google_cloud_run_v2_service.web.name
  }
}

resource "google_compute_backend_service" "web" {
  count                 = var.enable_lb ? 1 : 0
  name                  = "${var.resource_prefix}-web-backend"
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
    group = google_compute_region_network_endpoint_group.web_neg[0].id
  }
}

resource "google_compute_url_map" "web" {
  count           = var.enable_lb ? 1 : 0
  name            = "${var.resource_prefix}-urlmap"
  default_service = google_compute_backend_service.web[0].id
}

resource "google_compute_managed_ssl_certificate" "web" {
  count = var.enable_lb ? 1 : 0
  # outvers-cert-2, NOT outvers-cert. The original stuck in
  # PROVISIONING_FAILED_PERMANENTLY on 2026-06-20 and was replaced out-of-band by
  # outvers-cert-2 (ACTIVE since 2026-07-08), but state kept pointing at the dead
  # one — so a plan wanted to swap the live HTTPS proxy back onto a cert that can
  # never provision. Reconciled 2026-07-31 via state rm + import.
  name = "${var.resource_prefix}-cert-2"
  managed {
    domains = [var.domain, "www.${var.domain}"]
  }

  # A managed cert cannot be deleted while a target proxy references it, so a
  # rename must build the replacement before tearing the old one down. Without
  # this, the next name change deadlocks mid-apply with TLS pointing at nothing.
  lifecycle {
    create_before_destroy = true
  }
}

resource "google_compute_target_https_proxy" "web" {
  count            = var.enable_lb ? 1 : 0
  name             = "${var.resource_prefix}-https-proxy"
  url_map          = google_compute_url_map.web[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.web[0].id]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = var.enable_lb ? 1 : 0
  name                  = "${var.resource_prefix}-https-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_https_proxy.web[0].id
  port_range            = "443"
  ip_address            = google_compute_global_address.lb_ip[0].id
}

# Port 80 → 301 to HTTPS.
resource "google_compute_url_map" "http_redirect" {
  count = var.enable_lb ? 1 : 0
  name  = "${var.resource_prefix}-http-redirect"
  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "web" {
  count   = var.enable_lb ? 1 : 0
  name    = "${var.resource_prefix}-http-proxy"
  url_map = google_compute_url_map.http_redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = var.enable_lb ? 1 : 0
  name                  = "${var.resource_prefix}-http-fr"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  target                = google_compute_target_http_proxy.web[0].id
  port_range            = "80"
  ip_address            = google_compute_global_address.lb_ip[0].id
}
