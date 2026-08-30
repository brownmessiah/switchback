# -*- mode: Python -*-
# Tiltfile — local dev stack for switchback-next (Docker-free).
#
# `tilt up` brings the whole stack up and exposes the UI on the reserved ngrok
# URL so you can view it from anywhere:
#
#   • stack-setup — native Postgres@15 (:5544) + Meilisearch (:7700), schema
#                   push, seed, search reindex, and .env.local wiring
#   • dev-server  — Next.js dev server (:3000)
#   • ngrok       — reverse proxy on the reserved domain → :3000
#
# All the real work lives in scripts/dev-stack.sh — Tilt just orchestrates the
# dependency order and supervises the two long-running processes (dashboard,
# log multiplexing, restart buttons at http://localhost:10350).
#
# `tilt down` stops dev-server + ngrok; stop the backing services (Postgres +
# Meilisearch) with `pnpm dev:stack:down`. Same primitives as `pnpm dev:stack`.

NGROK_DOMAIN = os.getenv('SWITCHBACK_NGROK_DOMAIN', '2e99352b354d.ngrok.app')

# 1. Backing services + schema + seed + search index. One-shot and idempotent —
#    safe to re-run; reuses an already-running Postgres/Meilisearch.
local_resource(
    'stack-setup',
    cmd='bash scripts/dev-stack.sh up --no-dev',
    labels=['infra'],
)

# 2. Next.js dev server — supervised; ready once :3000 responds.
local_resource(
    'dev-server',
    serve_cmd='bash scripts/dev-stack.sh serve',
    resource_deps=['stack-setup'],
    readiness_probe=probe(
        period_secs=3,
        http_get=http_get_action(port=3000, path='/'),
    ),
    links=[link('http://localhost:3000', 'local')],
    labels=['app'],
)

# 3. ngrok reverse proxy on the reserved domain — ready once its local API is up.
local_resource(
    'ngrok',
    serve_cmd='bash scripts/dev-stack.sh proxy',
    resource_deps=['dev-server'],
    readiness_probe=probe(
        period_secs=3,
        http_get=http_get_action(port=4040, path='/api/tunnels'),
    ),
    links=[link('https://' + NGROK_DOMAIN, 'public URL')],
    labels=['app'],
)

print('switchback dev stack — once green, the UI is live at https://' + NGROK_DOMAIN)
