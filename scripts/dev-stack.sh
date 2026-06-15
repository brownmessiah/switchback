#!/usr/bin/env bash
#
# scripts/dev-stack.sh — self-contained local dev stack for outvers-next.
#
# Brings up an ISOLATED Postgres cluster + Meilisearch, wires .env.local to
# them, applies the schema, seeds the catalog, populates the search index,
# and starts the Next.js dev server — in one command. No Docker required.
#
# All state lives under .dev-stack/ (gitignored) so it never touches your
# system Postgres, your Neon dev branch, or the E2E cluster.
#
#   pnpm dev:stack              # up: provision + seed + start dev server
#   pnpm dev:stack:public       # same, PLUS an ngrok tunnel (view from anywhere)
#   pnpm dev:stack:prod         # production build (next build) + next start + tunnel
#   pnpm dev:stack:tunnel       # start just the ngrok tunnel (stack already up)
#   pnpm dev:stack:status       # what's running
#   pnpm dev:stack:down         # stop app + Postgres + Meilisearch + ngrok (keeps data)
#   pnpm dev:stack:reset        # drop + re-create + re-seed the DB
#   pnpm dev:stack:nuke         # stop everything and delete .dev-stack/
#
# Flags (for `up`): --prod --no-build --tunnel --no-dev --no-seed --no-reindex
#                   --no-schema --demo --blog
#
# Overridable via env: OUTVERS_PG_PORT OUTVERS_PG_DB OUTVERS_MEILI_PORT
#                      OUTVERS_MEILI_KEY OUTVERS_MEILI_VERSION OUTVERS_APP_URL
#                      OUTVERS_NGROK_DOMAIN
set -euo pipefail

# ---------------------------------------------------------------------------
# Resolve repo root (script lives in scripts/) and load config.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

STACK_DIR="$ROOT/.dev-stack"
PGDATA="$STACK_DIR/pgdata"
MEILI_DATA="$STACK_DIR/meili-data"
BIN_DIR="$STACK_DIR/bin"
LOG_DIR="$STACK_DIR/logs"
RUN_DIR="$STACK_DIR/run"

# Dedicated dev port (distinct from system :5432 and the E2E :5433) so the
# stack is fully isolated. You never type it — .env.local is wired for you.
PG_PORT="${OUTVERS_PG_PORT:-5544}"
PG_DB="${OUTVERS_PG_DB:-outvers_dev}"
PG_USER="$(whoami)"
MEILI_PORT="${OUTVERS_MEILI_PORT:-7700}"
MEILI_KEY="${OUTVERS_MEILI_KEY:-dev-master-key}"
MEILI_VERSION="${OUTVERS_MEILI_VERSION:-v1.14.0}"
APP_URL="${OUTVERS_APP_URL:-http://localhost:3000}"
# Reserved ngrok domain — the same public URL each run. Already trusted by
# next.config.ts (allowedDevOrigins + serverActions) and lib/auth trustedOrigins.
NGROK_DOMAIN="${OUTVERS_NGROK_DOMAIN:-2e99352b354d.ngrok.app}"
ENV_FILE="$ROOT/.env.local"
DB_URL="postgresql://$PG_USER@localhost:$PG_PORT/$PG_DB"

# ---------------------------------------------------------------------------
# Pretty output.
# ---------------------------------------------------------------------------
BOLD=$'\033[1m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLU=$'\033[34m'; RST=$'\033[0m'
log()  { printf '%s▸%s %s\n' "$BLU" "$RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$RST" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$RST" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$RED" "$RST" "$*" >&2; exit 1; }

usage() {
  # Print the leading comment block (after the shebang), up to the first
  # non-comment line — single source of truth for the help text.
  awk 'NR==1 || /^#!/ {next} /^#/ {sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

# Start a long-lived daemon DETACHED into its own session, so it survives the
# parent's process group being torn down — e.g. Tilt SIGTERMs a one-shot
# local_resource's process group when the cmd completes, which would otherwise
# reap a plain `nohup ... &` child (this is exactly why Meilisearch died under
# Tilt while pg_ctl-daemonized Postgres lived). macOS ships no `setsid`, so use
# Perl's POSIX::setsid; `exec` preserves the pid we record in the pidfile.
start_detached() {
  local logf="$1" pidf="$2"; shift 2
  mkdir -p "$(dirname "$logf")" "$(dirname "$pidf")"
  if command -v perl >/dev/null 2>&1; then
    perl -MPOSIX -e 'open(STDIN,"<","/dev/null"); POSIX::setsid(); exec @ARGV or die "exec: $!"' "$@" >"$logf" 2>&1 &
  elif command -v setsid >/dev/null 2>&1; then
    setsid "$@" >"$logf" 2>&1 </dev/null &
  else
    nohup "$@" >"$logf" 2>&1 </dev/null &
  fi
  echo $! > "$pidf"
}

# ---------------------------------------------------------------------------
# Postgres — isolated cluster managed entirely under .dev-stack/.
# ---------------------------------------------------------------------------
PG_BIN=""
resolve_pg_bin() {
  [ -n "$PG_BIN" ] && return
  if command -v pg_ctl >/dev/null 2>&1 && command -v initdb >/dev/null 2>&1; then
    PG_BIN="$(dirname "$(command -v pg_ctl)")"; return
  fi
  local p
  for p in \
    "$(brew --prefix postgresql@15 2>/dev/null)/bin" \
    "$(brew --prefix postgresql@16 2>/dev/null)/bin" \
    /opt/homebrew/opt/postgresql@15/bin \
    /usr/local/opt/postgresql@15/bin \
    /opt/homebrew/opt/postgresql@16/bin; do
    if [ -x "$p/initdb" ] && [ -x "$p/pg_ctl" ]; then PG_BIN="$p"; return; fi
  done
  die "Postgres tools (initdb/pg_ctl) not found. Install with: brew install postgresql@15"
}

# pnpm is a lazy-nvm shell function in interactive shells, so a plain
# `bash scripts/dev-stack.sh` subprocess won't find it (nor node). When run
# via `pnpm dev:stack` it's already on PATH; otherwise put the default nvm
# node version's bin dir on PATH ourselves so db:push / db:seed / dev work.
ensure_node_runtime() {
  command -v pnpm >/dev/null 2>&1 && return
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}" ver bindir
  if [ -d "$nvm_dir/versions/node" ]; then
    ver="$(cat "$nvm_dir/alias/default" 2>/dev/null || true)"
    bindir=""
    [ -n "$ver" ] && bindir="$(ls -d "$nvm_dir"/versions/node/v${ver}*/bin 2>/dev/null | sort -V | tail -1 || true)"
    [ -z "$bindir" ] && bindir="$(ls -d "$nvm_dir"/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
    [ -n "$bindir" ] && [ -d "$bindir" ] && export PATH="$bindir:$PATH"
  fi
  command -v pnpm >/dev/null 2>&1 && return
  command -v corepack >/dev/null 2>&1 && { corepack enable pnpm >/dev/null 2>&1 || true; }
  command -v pnpm >/dev/null 2>&1 || die "pnpm not found on PATH. Run via \`pnpm dev:stack\`, or enable it: corepack enable pnpm"
}

port_busy() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
pg_running() { resolve_pg_bin; "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }

ensure_pg() {
  resolve_pg_bin
  mkdir -p "$STACK_DIR" "$LOG_DIR" "$RUN_DIR"
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    log "Initializing Postgres cluster (.dev-stack/pgdata)"
    mkdir -p "$PGDATA"
    "$PG_BIN/initdb" -D "$PGDATA" -U "$PG_USER" --auth=trust --encoding=UTF8 >/dev/null
    ok "Cluster initialized"
  fi
  if pg_running; then
    ok "Postgres already running (port $PG_PORT)"
  else
    port_busy "$PG_PORT" && die "Port $PG_PORT is in use by another process. Set OUTVERS_PG_PORT to override."
    log "Starting Postgres on port $PG_PORT"
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$LOG_DIR/pg.log" \
      -o "-p $PG_PORT -c listen_addresses=localhost" -w start >/dev/null \
      || die "Postgres failed to start — see .dev-stack/logs/pg.log"
    ok "Postgres up (port $PG_PORT)"
  fi
  if ! "$PG_BIN/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d postgres -tAc \
       "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" | grep -q 1; then
    log "Creating database $PG_DB"
    "$PG_BIN/createdb" -h localhost -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
    ok "Database $PG_DB created"
  fi
}

# ---------------------------------------------------------------------------
# Meilisearch — pinned binary cached under .dev-stack/bin (no Docker/brew).
# ---------------------------------------------------------------------------
MEILI_BIN="$BIN_DIR/meilisearch"

meili_asset() {
  local os arch; os="$(uname -s)"; arch="$(uname -m)"
  case "$os/$arch" in
    Darwin/arm64)  echo "meilisearch-macos-apple-silicon" ;;
    Darwin/x86_64) echo "meilisearch-macos-amd64" ;;
    Linux/x86_64)  echo "meilisearch-linux-amd64" ;;
    Linux/aarch64|Linux/arm64) echo "meilisearch-linux-aarch64" ;;
    *) echo "" ;;
  esac
}

ensure_meili_bin() {
  [ -x "$MEILI_BIN" ] && return
  local asset url; asset="$(meili_asset)"
  [ -n "$asset" ] || die "No Meilisearch binary for $(uname -s)/$(uname -m). Set OUTVERS_MEILI_* or install manually."
  url="https://github.com/meilisearch/meilisearch/releases/download/$MEILI_VERSION/$asset"
  log "Downloading Meilisearch $MEILI_VERSION ($asset)"
  mkdir -p "$BIN_DIR"
  curl -fL# "$url" -o "$MEILI_BIN" || die "Download failed: $url"
  chmod +x "$MEILI_BIN"
  ok "Meilisearch cached (.dev-stack/bin/meilisearch)"
}

meili_running() { curl -fsS "http://localhost:$MEILI_PORT/health" >/dev/null 2>&1; }

ensure_meili() {
  ensure_meili_bin
  if meili_running; then ok "Meilisearch already running (port $MEILI_PORT)"; return; fi
  port_busy "$MEILI_PORT" && die "Port $MEILI_PORT in use but not a healthy Meilisearch. Set OUTVERS_MEILI_PORT."
  log "Starting Meilisearch on port $MEILI_PORT"
  mkdir -p "$MEILI_DATA" "$LOG_DIR" "$RUN_DIR"
  start_detached "$LOG_DIR/meili.log" "$RUN_DIR/meili.pid" \
    "$MEILI_BIN" --master-key "$MEILI_KEY" --db-path "$MEILI_DATA" \
    --http-addr "localhost:$MEILI_PORT" --env development
  local i
  for i in $(seq 1 40); do if meili_running; then break; fi; sleep 0.25; done
  meili_running || die "Meilisearch did not become healthy — see .dev-stack/logs/meili.log"
  ok "Meilisearch up (port $MEILI_PORT)"
}

# ---------------------------------------------------------------------------
# ngrok reverse proxy — exposes the dev server on a fixed public URL so you
# can view the UI from anywhere. App-side trust is already configured.
# ---------------------------------------------------------------------------
ngrok_api() { curl -fsS --max-time 2 http://localhost:4040/api/tunnels 2>/dev/null; }
ngrok_tunneling_ours() { ngrok_api | grep -q "$NGROK_DOMAIN"; }

ensure_ngrok() {
  command -v ngrok >/dev/null 2>&1 \
    || die "ngrok not installed. Install: brew install ngrok  (then: ngrok config add-authtoken <token>)"
  if ngrok_api >/dev/null 2>&1; then
    if ngrok_tunneling_ours; then ok "ngrok already tunneling https://$NGROK_DOMAIN"; return; fi
    die "An ngrok agent is already running on :4040 with a different tunnel. Stop it (pnpm dev:stack:down) or kill the ngrok process first."
  fi
  log "Starting ngrok → https://$NGROK_DOMAIN (proxying :3000)"
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  start_detached "$LOG_DIR/ngrok.log" "$RUN_DIR/ngrok.pid" \
    ngrok http 3000 --domain="$NGROK_DOMAIN" --log=stdout
  local i
  for i in $(seq 1 40); do if ngrok_api >/dev/null 2>&1; then break; fi; sleep 0.25; done
  ngrok_api >/dev/null 2>&1 || die "ngrok did not come up — see .dev-stack/logs/ngrok.log (reserved-domain or authtoken issue?)"
  ok "ngrok up → https://$NGROK_DOMAIN"
}

# ---------------------------------------------------------------------------
# .env.local wiring — idempotent, order-preserving, backed up before changes.
# ---------------------------------------------------------------------------
upsert_env() {
  local key="$1" val="$2" tmp; tmp="$(mktemp)"
  touch "$ENV_FILE"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS="="} $1==k{print k"="v; next} {print}' "$ENV_FILE" > "$tmp"
  else
    cat "$ENV_FILE" > "$tmp"; printf '%s=%s\n' "$key" "$val" >> "$tmp"
  fi
  mv "$tmp" "$ENV_FILE"
}

backup_env() {
  [ -f "$ENV_FILE" ] || { touch "$ENV_FILE"; return; }
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$ENV_FILE.bak.$stamp"
  log "Backed up .env.local → .env.local.bak.$stamp"
}

ensure_secret() {
  local cur
  cur="$(grep -E '^BETTER_AUTH_SECRET=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ "${#cur}" -lt 32 ]; then
    log "Generating BETTER_AUTH_SECRET (openssl rand)"
    upsert_env BETTER_AUTH_SECRET "$(openssl rand -base64 48)"
  fi
}

wire_env() {
  local old_db
  old_db="$(grep -E '^DATABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  if [ "$old_db" != "$DB_URL" ]; then
    [ -n "$old_db" ] && warn "DATABASE_URL: $old_db → $DB_URL"
    upsert_env DATABASE_URL "$DB_URL"
  fi
  upsert_env MEILISEARCH_HOST "http://localhost:$MEILI_PORT"
  upsert_env MEILISEARCH_KEY "$MEILI_KEY"
  upsert_env NEXT_PUBLIC_APP_URL "$APP_URL"
  ensure_secret
  ok "Wired .env.local to the local stack"
}

export_env_for_children() {
  export DATABASE_URL="$DB_URL"
  export MEILISEARCH_HOST="http://localhost:$MEILI_PORT"
  export MEILISEARCH_KEY="$MEILI_KEY"
  export NEXT_PUBLIC_APP_URL="$APP_URL"
}

# ---------------------------------------------------------------------------
# Schema / seed / index.
# ---------------------------------------------------------------------------
push_schema() {
  [ "$DO_SCHEMA" = true ] || { warn "Skipping schema push (--no-schema)"; return; }
  log "Applying schema (drizzle-kit push)"
  pnpm exec drizzle-kit push --force
  ok "Schema applied to $PG_DB"
}

seed_db() {
  [ "$DO_SEED" = true ] || { warn "Skipping seed (--no-seed)"; return; }
  log "Seeding base catalog (idempotent)"
  pnpm db:seed
  [ "$DO_DEMO" = true ] && { log "Seeding demo catalog"; pnpm db:seed:demo; }
  [ "$DO_BLOG" = true ] && { log "Seeding blog corpus"; pnpm db:seed:blog; }
  ok "Seed complete"
}

reindex() {
  [ "$DO_REINDEX" = true ] || { warn "Skipping reindex (--no-reindex)"; return; }
  if ! meili_running; then warn "Meilisearch not running — skipping reindex"; return; fi
  log "Reindexing experiences into Meilisearch"
  pnpm search:reindex
  ok "Search index populated"
}

print_summary() {
  printf '\n%s━━━━━━━━ outvers dev stack ━━━━━━━━%s\n' "$BOLD" "$RST"
  printf '  Postgres     localhost:%s  (db %s · user %s)\n' "$PG_PORT" "$PG_DB" "$PG_USER"
  printf '  Meilisearch  http://localhost:%s\n' "$MEILI_PORT"
  printf '  App          %s%s\n' "$APP_URL" "$([ "$WITH_PROD" = true ] && echo '  (production build · next start)')"
  [ "$WITH_TUNNEL" = true ] && printf '  Public URL   https://%s  (ngrok · view from anywhere)\n' "$NGROK_DOMAIN"
  printf '  DB URL       %s\n' "$DB_URL"
  printf '  State        .dev-stack/  (gitignored · run `pnpm dev:stack:nuke` to wipe)\n\n'
}

# ---------------------------------------------------------------------------
# Subcommands.
# ---------------------------------------------------------------------------
# Production build + serve (--prod). Unlike dev, the server runs DETACHED and
# tracked via app.pid, so `dev:stack:down` stops it like the other services.
build_app() {
  [ "$DO_BUILD" = true ] || { warn "Skipping build (--no-build) — serving the existing .next"; return; }
  log "Building for production (next build)"
  pnpm build
  ok "Production build complete"
}

start_prod_server() {
  if port_busy 3000; then
    warn "Port 3000 already in use — leaving the existing server (run dev:stack:down first to replace it)"
    return
  fi
  log "Starting production server (next start, detached)"
  start_detached "$LOG_DIR/app.log" "$RUN_DIR/app.pid" pnpm start
  local i
  for i in $(seq 1 80); do
    if curl -fsS -o /dev/null --max-time 2 "http://localhost:3000/" 2>/dev/null; then break; fi
    sleep 0.5
  done
  curl -fsS -o /dev/null --max-time 2 "http://localhost:3000/" 2>/dev/null \
    && ok "Production server up (http://localhost:3000)" \
    || die "Production server did not respond — see .dev-stack/logs/app.log"
}

cmd_up() {
  mkdir -p "$STACK_DIR" "$LOG_DIR" "$RUN_DIR"
  ensure_node_runtime
  backup_env
  ensure_pg
  ensure_meili
  wire_env
  export_env_for_children
  push_schema
  seed_db
  reindex
  if [ "$WITH_PROD" = true ]; then
    build_app
    start_prod_server
    [ "$WITH_TUNNEL" = true ] && ensure_ngrok
    print_summary
    ok "Production stack running in the background (next start, detached)."
    printf '\nManage:\n  pnpm dev:stack:status    # check services\n  pnpm dev:stack:down      # stop app + Postgres + Meilisearch + ngrok\n\n'
    return
  fi
  [ "$WITH_TUNNEL" = true ] && ensure_ngrok
  print_summary
  if [ "$START_DEV" = true ]; then
    log "Starting Next.js dev server — Ctrl-C stops it; Postgres + Meilisearch keep running"
    exec pnpm dev
  fi
  ok "Stack ready. Backing services running in the background."
  printf '\nNext:\n  pnpm dev                 # start the app against this stack\n  pnpm dev:stack:status    # check services\n  pnpm dev:stack:down      # stop Postgres + Meilisearch\n\n'
}

cmd_down() {
  resolve_pg_bin
  if [ -f "$RUN_DIR/app.pid" ]; then
    local apid; apid="$(cat "$RUN_DIR/app.pid")"
    if kill -0 "$apid" 2>/dev/null; then
      # `pnpm start` leads a session (start_detached setsid) whose group includes
      # the child `next start` — signal the whole group so nothing is orphaned.
      kill -TERM "-$apid" 2>/dev/null || kill "$apid" 2>/dev/null
      ok "Stopped app server (pid $apid)"
    fi
    rm -f "$RUN_DIR/app.pid"
  fi
  if [ -f "$RUN_DIR/ngrok.pid" ]; then
    local npid; npid="$(cat "$RUN_DIR/ngrok.pid")"
    if kill -0 "$npid" 2>/dev/null; then kill "$npid" 2>/dev/null && ok "Stopped ngrok (pid $npid)"; fi
    rm -f "$RUN_DIR/ngrok.pid"
  elif ngrok_api >/dev/null 2>&1; then
    warn "ngrok running but no pid file — kill it manually if it was started outside this script"
  fi
  if [ -f "$RUN_DIR/meili.pid" ]; then
    local pid; pid="$(cat "$RUN_DIR/meili.pid")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null && ok "Stopped Meilisearch (pid $pid)"; fi
    rm -f "$RUN_DIR/meili.pid"
  elif meili_running; then
    warn "Meilisearch healthy but no pid file — kill it manually if it was started outside this script"
  else
    warn "Meilisearch already stopped"
  fi
  if pg_running; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null && ok "Stopped Postgres"
  else
    warn "Postgres already stopped"
  fi
}

cmd_status() {
  printf '%soutvers dev stack status%s\n' "$BOLD" "$RST"
  if pg_running; then ok "Postgres running (port $PG_PORT · db $PG_DB)"; else warn "Postgres stopped"; fi
  if meili_running; then ok "Meilisearch healthy (http://localhost:$MEILI_PORT)"; else warn "Meilisearch stopped"; fi
  if port_busy 3000; then ok "Dev server listening on :3000"; else warn "Dev server not running"; fi
  if ngrok_api >/dev/null 2>&1; then
    if ngrok_tunneling_ours; then ok "ngrok tunneling https://$NGROK_DOMAIN"; else warn "ngrok running (different tunnel)"; fi
  else warn "ngrok not running"; fi
}

# Foreground entrypoints for a process supervisor (e.g. Tilt's local_resource
# serve_cmd). Unlike `up`/`tunnel` these do NOT background — the supervisor owns
# the process lifecycle. `serve` heals PATH first (pnpm is a lazy-nvm function).
cmd_serve() {
  ensure_node_runtime
  log "Next.js dev server (foreground, supervised)"
  exec pnpm dev
}

cmd_proxy() {
  command -v ngrok >/dev/null 2>&1 \
    || die "ngrok not installed. Install: brew install ngrok  (then: ngrok config add-authtoken <token>)"
  log "ngrok (foreground, supervised) → https://$NGROK_DOMAIN proxying :3000"
  exec ngrok http 3000 --domain="$NGROK_DOMAIN" --log=stdout
}

cmd_tunnel() {
  ensure_ngrok
  port_busy 3000 || warn "Nothing is listening on :3000 yet — start the app (pnpm dev / pnpm dev:stack) so the tunnel has an upstream."
  printf '\n%sPublic URL%s  https://%s  →  http://localhost:3000\n' "$BOLD" "$RST" "$NGROK_DOMAIN"
  printf 'Inspect     http://localhost:4040\n'
  printf 'Stop        pnpm dev:stack:down\n\n'
}

cmd_reset() {
  ensure_node_runtime
  ensure_pg
  log "Dropping and recreating $PG_DB (destroys local dev data)"
  "$PG_BIN/psql" -h localhost -p "$PG_PORT" -U "$PG_USER" -d postgres -c \
    "DROP DATABASE IF EXISTS $PG_DB WITH (FORCE)" >/dev/null
  "$PG_BIN/createdb" -h localhost -p "$PG_PORT" -U "$PG_USER" "$PG_DB"
  ok "Database recreated"
  ensure_meili
  export_env_for_children
  push_schema
  seed_db
  reindex
  ok "Reset complete"
}

cmd_nuke() {
  cmd_down || true
  log "Removing .dev-stack/"
  rm -rf "$STACK_DIR"
  ok "Removed all dev-stack state (.env.local backups kept)"
}

cmd_logs() {
  [ -d "$LOG_DIR" ] || die "No logs yet — run \`pnpm dev:stack\` first."
  tail -n 50 -f "$LOG_DIR"/*.log
}

# ---------------------------------------------------------------------------
# Arg parsing + dispatch.
# ---------------------------------------------------------------------------
CMD="up"
START_DEV=true; DO_SEED=true; DO_DEMO=false; DO_BLOG=false; DO_REINDEX=true; DO_SCHEMA=true
WITH_TUNNEL=false; WITH_PROD=false; DO_BUILD=true

if [ $# -gt 0 ]; then
  case "$1" in
    up|down|status|reset|nuke|logs|tunnel|serve|proxy) CMD="$1"; shift ;;
    -h|--help) usage; exit 0 ;;
  esac
fi

while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel)     WITH_TUNNEL=true ;;
    --prod)       WITH_PROD=true ;;
    --no-build)   DO_BUILD=false ;;
    --no-dev)     START_DEV=false ;;
    --no-seed)    DO_SEED=false ;;
    --no-reindex) DO_REINDEX=false ;;
    --no-schema)  DO_SCHEMA=false ;;
    --demo)       DO_DEMO=true ;;
    --blog)       DO_BLOG=true ;;
    -h|--help)    usage; exit 0 ;;
    *) die "Unknown option: $1 (run with --help)" ;;
  esac
  shift
done

case "$CMD" in
  up)     cmd_up ;;
  down)   cmd_down ;;
  status) cmd_status ;;
  reset)  backup_env; cmd_reset ;;
  nuke)   cmd_nuke ;;
  logs)   cmd_logs ;;
  tunnel) cmd_tunnel ;;
  serve)  cmd_serve ;;
  proxy)  cmd_proxy ;;
  *) die "Unknown command: $CMD" ;;
esac
