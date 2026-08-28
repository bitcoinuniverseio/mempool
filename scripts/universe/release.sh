#!/usr/bin/env bash
#
# Installs a Universe Explorer release beside the running one and cuts over to
# it only after every gate passes.
#
# The gates exist because the previous release passed CI and still shipped a
# Charts page and a Mining dashboard whose backend routes were never mounted.
# CI answered from fixtures; nothing checked the deployed configuration. So the
# checks here run against the release that is about to serve traffic, before
# the symlink moves, and the cutover is refused if any of them fails.
#
# Usage:
#   release.sh install <sha> <artifact.tar.gz>   unpack beside the current release
#   release.sh preflight <sha>                   run the gates, change nothing
#   release.sh cutover <sha>                     gate, switch, restart, verify
#   release.sh rollback <sha>                    point back at a previous release
#
set -euo pipefail

ROOT=/opt/universe-explorer
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
CONF=/etc/universe-explorer
UNITS="universe-explorer-backend universe-explorer-overlay universe-explorer-gateway"
GATEWAY=http://127.0.0.1:8099
BACKEND=http://127.0.0.1:8996
OVERLAY=http://127.0.0.1:3400

log()  { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '%s FAILED: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

release_dir() { printf '%s/mempool-%s' "$RELEASES" "$1"; }

# ---------------------------------------------------------------- install ----

cmd_install() {
  local sha=$1 tarball=$2
  local dir; dir=$(release_dir "$sha")
  [ -f "$tarball" ] || fail "no artifact at $tarball"
  [ -e "$dir" ] && fail "$dir already exists; releases are never overwritten in place"

  local previous; previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  mkdir -p "$dir"
  tar -xzf "$tarball" -C "$dir"

  # Dependencies and the compiled gbt module do not change between most
  # releases, so they are hard-linked from the running one. That keeps the
  # install quick and the disk flat, and the files stay immutable either way.
  if [ -n "$previous" ] && [ -d "$previous/backend/node_modules" ]; then
    [ -d "$dir/backend/node_modules" ] || cp -al "$previous/backend/node_modules" "$dir/backend/node_modules"
    [ -d "$dir/backend/rust-gbt" ]     || cp -al "$previous/backend/rust-gbt" "$dir/backend/rust-gbt"
    [ -f "$dir/backend/package.json" ] || cp -a  "$previous/backend/package.json" "$dir/backend/package.json"
    [ -d "$dir/rust" ]                 || cp -al "$previous/rust" "$dir/rust"
  fi

  printf '%s\n' "$sha" > "$dir/RELEASE-SHA"
  chown -R root:universe-explorer "$dir"
  chmod -R go-w "$dir"
  log "installed $dir"
}

# --------------------------------------------------------------- preflight ---

# Reads a JSON value out of the backend configuration without printing secrets.
conf_value() {
  python3 -c "
import json,sys
conf=json.load(open('$CONF/backend.json'))
node=conf
for key in sys.argv[1].split('.'):
    node=node[key]
print(json.dumps(node))
" "$1"
}

gate_release_present() {
  local dir=$1
  [ -f "$dir/backend/dist/index.js" ]        || fail "release has no backend build"
  [ -f "$dir/frontend/build/index.html" ]    || fail "release has no frontend build"
  [ -f "$dir/scripts/universe/gateway.mjs" ] || fail "release has no gateway"
  [ -f "$dir/backend/dist/tasks/pools/pools-v2.json" ] \
    || fail "release has no bundled mining pool metadata, so enabling the database would abort at startup"
}

# The same combinations the backend refuses at startup, checked before cutover
# so an incoherent configuration never reaches a restart.
gate_configuration() {
  local database statistics indexing mempool
  database=$(conf_value DATABASE.ENABLED)
  statistics=$(conf_value STATISTICS.ENABLED)
  indexing=$(conf_value MEMPOOL.INDEXING_BLOCKS_AMOUNT)
  mempool=$(conf_value MEMPOOL.ENABLED)

  [ "$statistics" = true ] && [ "$database" != true ] \
    && fail "statistics is on with the database off, so no statistics route would be served"
  [ "$statistics" = true ] && [ "$mempool" != true ] \
    && fail "statistics is on with the mempool backend off, so nothing would collect it"
  [ "$indexing" != 0 ] && [ "$database" != true ] \
    && fail "block indexing is set with the database off, so no mining route would be served"
  log "configuration is coherent"
}

gate_database() {
  [ "$(conf_value DATABASE.ENABLED)" = true ] || { log "database disabled, skipping"; return; }
  python3 - <<'PY' || fail "the configured database did not answer"
import json, socket
conf = json.load(open('/etc/universe-explorer/backend.json'))['DATABASE']
with socket.create_connection((conf['HOST'], conf['PORT']), timeout=5):
    pass
PY
  log "database accepts connections"
}

# An address backend configured at a port nothing listens on does not fail
# loudly: it retries. That produced roughly two connection errors a second,
# forever, which buried every real error in the journal.
gate_address_backend() {
  local backend; backend=$(conf_value MEMPOOL.BACKEND | tr -d '"')
  [ "$backend" = electrum ] || { log "address backend is $backend, nothing to reach"; return; }
  python3 - <<'PYGATE' || fail "MEMPOOL.BACKEND is electrum but nothing is listening on the configured Electrum port"
import json, socket
conf = json.load(open('/etc/universe-explorer/backend.json'))['ELECTRUM']
with socket.create_connection((conf['HOST'], conf['PORT']), timeout=5):
    pass
PYGATE
  log "the configured Electrum server accepts connections"
}

gate_sources_parse() {
  python3 - <<'PY' || fail "the overlay source registry is not valid"
import json, os, re
env = {}
for line in open('/etc/universe-explorer/overlay.env', encoding='utf-8'):
    line = line.rstrip('\n')
    if '=' in line and not line.startswith('#'):
        key, value = line.split('=', 1)
        env[key] = value
raw = env.get('UNIVERSE_EXPLORER_SOURCES_JSON', '')
sources = json.loads(raw) if raw else []
assert isinstance(sources, list) and sources, 'no sources configured'
for source in sources:
    name = source['bearerTokenEnv']
    token = env.get(name, '')
    assert len(token.encode()) >= 32, f'token variable {name} is missing or too short'
    assert re.match(r'^https?://', source['origin']), 'origin must be an http(s) origin'
print(f'{len(sources)} sources parse, every token variable is present')
PY
  log "overlay source registry parses with every token present"
}

# A protocol the registry calls readable must have an authority configured for
# it, or the protocols page will advertise something nothing can answer.
gate_readable_protocols_have_authorities() {
  local dir=$1
  python3 - "$dir" <<'PY' || fail "a readable protocol has no configured authority"
import json, sys, subprocess

env = {}
for line in open('/etc/universe-explorer/overlay.env', encoding='utf-8'):
    if '=' in line and not line.startswith('#'):
        key, value = line.rstrip('\n').split('=', 1)
        env[key] = value
raw = env.get('UNIVERSE_EXPLORER_SOURCES_JSON', '')
configured = {s['authorityId'] for s in (json.loads(raw) if raw else [])}

out = subprocess.run(
    ['curl', '-sS', '-m', '10', 'http://127.0.0.1:3400/api/v1/universe/protocols'],
    capture_output=True, text=True)
if out.returncode != 0 or not out.stdout.strip():
    print('overlay not answering yet, skipping this gate')
    sys.exit(0)

manifest = json.loads(out.stdout)
missing = [
    p['id'] for p in manifest['protocols']
    if p.get('releaseStatus', '').upper().startswith('VERIFIED')
    and p.get('indexerAuthority')
    and p['indexerAuthority'] not in configured
]
if missing:
    print('readable protocols with no configured authority:', ', '.join(sorted(missing)))
    sys.exit(1)
print('every readable protocol has a configured authority')
PY
  log "readable protocols all have authorities"
}

cmd_preflight() {
  local sha=$1
  local dir; dir=$(release_dir "$sha")
  [ -d "$dir" ] || fail "no release at $dir"
  gate_release_present "$dir"
  gate_configuration
  gate_database
  gate_address_backend
  gate_sources_parse
  gate_readable_protocols_have_authorities "$dir"
  log "preflight passed for $sha"
}

# ---------------------------------------------------------------- cutover ----

# Waits for a URL to answer 200 within a bounded time.
wait_for() {
  local url=$1 name=$2 deadline=$((SECONDS + 90))
  while [ $SECONDS -lt $deadline ]; do
    if [ "$(curl -sS -o /dev/null -m 5 -w '%{http_code}' "$url" || true)" = 200 ]; then
      log "$name is answering"
      return 0
    fi
    sleep 2
  done
  return 1
}

# Returns non-zero rather than exiting, so a failed check can be rolled back
# instead of leaving the new release in place with nothing serving.
verify_live() {
  wait_for "$GATEWAY/__gateway/health" gateway       || { log "gateway did not come back"; return 1; }
  wait_for "$BACKEND/api/v1/backend-info" backend    || { log "backend did not come back"; return 1; }
  wait_for "$OVERLAY/api/v1/universe/status" overlay || { log "overlay did not come back"; return 1; }

  local served
  served=$(curl -sS -m 10 "$BACKEND/api/v1/backend-info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["gitCommit"])')
  log "backend reports $served"

  # A public feature must not be advertised by a backend that did not mount its
  # routes. This is the exact failure that shipped last time.
  python3 - "$BACKEND" <<'PY' || return 1
import json, subprocess, sys
answer = subprocess.run(
    ['curl', '-sS', '-m', '10', sys.argv[1] + '/api/v1/capabilities'],
    capture_output=True, text=True)
if answer.returncode != 0 or not answer.stdout.strip():
    print('the capability report could not be read')
    sys.exit(1)
report = json.loads(answer.stdout)
bad = [
    name for name, feature in report['features'].items()
    if feature['enabled'] and not feature['routesRegistered']
]
if bad:
    print('features enabled with no routes registered:', ', '.join(bad))
    sys.exit(1)
for name, feature in report['features'].items():
    print(f"{name}: enabled={feature['enabled']} routes={feature['routesRegistered']} state={feature['state']}")
PY
}

cmd_cutover() {
  local sha=$1
  local dir; dir=$(release_dir "$sha")
  cmd_preflight "$sha"

  local previous; previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  log "previous release: ${previous:-none}"

  ln -sfn "$dir" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
  log "current now points at $dir"

  # shellcheck disable=SC2086
  systemctl restart $UNITS
  if ! verify_live; then
    log "verification failed, rolling back"
    [ -n "$previous" ] && cmd_rollback "$(basename "$previous" | sed 's/^mempool-//')"
    fail "cutover verification failed"
  fi
  log "cutover to $sha complete"
}

cmd_rollback() {
  local sha=$1
  local dir; dir=$(release_dir "$sha")
  [ -d "$dir" ] || fail "no release at $dir to roll back to"
  ln -sfn "$dir" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
  # shellcheck disable=SC2086
  systemctl restart $UNITS
  verify_live || fail "rollback target did not come back either"
  log "rolled back to $sha"
}

case "${1:-}" in
  install)   cmd_install "$2" "$3" ;;
  preflight) cmd_preflight "$2" ;;
  cutover)   cmd_cutover "$2" ;;
  rollback)  cmd_rollback "$2" ;;
  *) fail "usage: release.sh {install <sha> <tarball>|preflight <sha>|cutover <sha>|rollback <sha>}" ;;
esac
