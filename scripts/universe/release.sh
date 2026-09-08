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
#   release.sh install <full-sha> <artifact.tar.gz>  verify and stage beside current
#   release.sh preflight <full-sha>                  run the gates, change nothing
#   release.sh cutover <full-sha>                    gate, switch, restart, verify
#   release.sh cutover <full-sha> --gateway-baseline first dynamic gateway migration
#   release.sh rollback <full-sha>                   restore Explorer, then hide v2
#
set -euo pipefail

ROOT=${UNIVERSE_EXPLORER_ROOT:-/opt/universe-explorer}
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
CONF=${UNIVERSE_EXPLORER_CONF:-/etc/universe-explorer}
GATEWAY=${UNIVERSE_EXPLORER_GATEWAY_ORIGIN:-http://127.0.0.1:8099}
BACKEND=${UNIVERSE_EXPLORER_BACKEND_ORIGIN:-http://127.0.0.1:8996}
OVERLAY=${UNIVERSE_EXPLORER_OVERLAY_ORIGIN:-http://127.0.0.1:3400}
REQUIRED_OVERLAY_SHA=${UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA:-}
GATEWAY_ROUTE_FILE=${UNIVERSE_EXPLORER_GATEWAY_ROUTE_FILE:-/var/lib/universe-explorer/overlay-route.json}
DEPLOY_LOCK=${UNIVERSE_EXPLORER_DEPLOY_LOCK:-/run/lock/universe-explorer-deploy.lock}

# The address the gates ask about. It is the receiving output of the first
# Bitcoin transaction ever sent between two people, in block 170, so its
# history cannot be undone and asking about it is cheap. The same address is
# named in the backend probe and the production synthetic check.
ADDRESS_PROBE=1Q2TWHE3GMdB6BZKafqwxXtWAWgFt5Jvm3
# Mainnet block zero. An index pointed at another network answers everything,
# and answers all of it wrong.
GENESIS_HASH=000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f

log()  { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }
fail() { printf '%s FAILED: %s\n' "$(date -u +%H:%M:%SZ)" "$*" >&2; exit 1; }

release_dir() { printf '%s/mempool-%s' "$RELEASES" "$1"; }

validate_full_sha() {
  local sha=$1
  validate_release_id "$sha"
  [ "${#sha}" -eq 40 ] || fail "release SHA must be 40 lowercase hexadecimal characters"
}

validate_release_id() {
  local sha=$1
  case "$sha" in *[!0-9a-f]*|'') fail "release SHA must use lowercase hexadecimal characters" ;; esac
  [ "${#sha}" -ge 7 ] && [ "${#sha}" -le 40 ] \
    || fail "release SHA must contain 7 to 40 lowercase hexadecimal characters"
}

verify_artifact_checksum() {
  local tarball=$1 checksum="$1.sha256" expected actual
  [ -f "$checksum" ] || fail "no checksum at $checksum"
  expected=$(awk 'NR == 1 { print $1 }' "$checksum")
  # GNU sha256sum prefixes a line with a backslash when the recorded filename
  # itself needs escaping. The hash remains the next 64 characters.
  expected=${expected#\\}
  case "$expected" in *[!0-9a-fA-F]*|'') fail "the artifact checksum is malformed" ;; esac
  [ "${#expected}" -eq 64 ] || fail "the artifact checksum is malformed"
  actual=$(sha256sum < "$tarball" | awk '{ print $1 }')
  [ "${actual,,}" = "${expected,,}" ] || fail "the artifact checksum does not match"
  log "artifact checksum verified: $actual"
}

# ---------------------------------------------------------------- install ----

cmd_install() {
  local sha=$1 tarball=$2 dir stage
  validate_full_sha "$sha"
  dir=$(release_dir "$sha")
  [ -f "$tarball" ] || fail "no artifact at $tarball"
  verify_artifact_checksum "$tarball"
  [ -e "$dir" ] && fail "$dir already exists; releases are never overwritten in place"
  mkdir -p "$RELEASES"
  stage=$(mktemp -d "$RELEASES/.mempool-$sha.XXXXXX")
  (
    trap 'rm -rf "$stage"' EXIT
    tar --no-same-owner --no-same-permissions -xzf "$tarball" -C "$stage"
    gate_release_present "$stage"
    gate_manifest_exact "$stage" "$sha"
    [ -d "$stage/backend/node_modules/@nestjs/core" ] \
      || fail "release has no production backend dependency tree"
    [ -e "$stage/backend/node_modules/rust-gbt" ] \
      || fail "release has no linked gbt runtime module"
    printf '%s\n' "$sha" > "$stage/RELEASE-SHA"
    chown -R root:universe-explorer "$stage"
    chmod -R a+rX,go-w "$stage"
    mv "$stage" "$dir"
    trap - EXIT
  )
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
  local dir=$1 mode=${2:-current}
  [ -f "$dir/backend/dist/index.js" ]        || fail "release has no backend build"
  [ -d "$dir/backend/node_modules/@nestjs/core" ] \
    || fail "release has no production backend dependency tree"
  [ -f "$dir/frontend/build/index.html" ]    || fail "release has no frontend build"
  [ -f "$dir/scripts/universe/gateway.mjs" ] || fail "release has no gateway"
  if [ "$mode" != legacy ]; then
    [ -f "$dir/production/linux/universe-explorer-gateway.socket" ] \
      || fail "release has no gateway socket unit"
    [ -f "$dir/production/linux/universe-explorer-gateway.service.d/10-socket.conf" ] \
      || fail "release has no gateway socket service drop-in"
  fi
  [ -f "$dir/backend/dist/tasks/pools/pools-v2.json" ] \
    || fail "release has no bundled mining pool metadata, so enabling the database would abort at startup"
  [ -f "$dir/RELEASE-MANIFEST.json" ] \
    || fail "release carries no manifest, so nothing states what its components are supposed to be"
}

gate_manifest_exact() {
  local dir=$1 sha=$2 named
  named=$(python3 -c "
import json,sys
print(json.load(open(sys.argv[1]))['commit'])
" "$dir/RELEASE-MANIFEST.json") || fail "the release manifest is not readable"
  [ "$named" = "$sha" ] \
    || fail "the release manifest names $named instead of the requested commit $sha"
  log "manifest names exact commit $named"
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

# Address lookup, held to the same standard as anything else this origin
# publicly offers.
#
# What was here before permitted the exact state that shipped. It looked at
# MEMPOOL.BACKEND, saw `none`, decided there was "nothing to reach", and passed.
# Meanwhile the header invited a reader to search an address, the search box
# recognised one, and every address answered 405 with a page that blamed the
# address for having too much history.
#
# So `none` is now a blocker, and a configured index has to prove itself with
# real requests rather than an open socket. A port that accepts a connection
# says nothing about whether the thing behind it has an index, is on this
# chain, has caught up, or can answer the three questions an address page asks.
gate_address_backend() {
  local backend; backend=$(conf_value MEMPOOL.BACKEND | tr -d '"')

  if [ "$backend" = none ]; then
    fail "MEMPOOL.BACKEND is none, so every address, script hash and UTXO lookup would fail while the site still offers them"
  fi

  if [ "$backend" = electrum ]; then
    python3 - <<'PYGATE' || fail "MEMPOOL.BACKEND is electrum but nothing is listening on the configured Electrum port"
import json, socket
conf = json.load(open('/etc/universe-explorer/backend.json'))['ELECTRUM']
with socket.create_connection((conf['HOST'], conf['PORT']), timeout=5):
    pass
PYGATE
    log "the configured Electrum server accepts connections"
    return
  fi

  [ "$backend" = esplora ] || fail "MEMPOOL.BACKEND is $backend, which is not an address backend this deployment knows how to gate"

  python3 - "$ADDRESS_PROBE" "$GENESIS_HASH" <<'PYGATE' || fail "the first-party address index is not ready to serve this release"
import json, sys, urllib.request, urllib.error

probe, genesis = sys.argv[1], sys.argv[2]
conf = json.load(open('/etc/universe-explorer/backend.json'))
esplora = conf.get('ESPLORA') or {}
base = esplora.get('REST_API_URL')
if not base:
    print('MEMPOOL.BACKEND is esplora but ESPLORA.REST_API_URL is not set')
    sys.exit(1)

# Data sovereignty. A fallback is a source too, and a fallback is exactly where
# a third-party API gets in unnoticed: it only answers when something is
# already wrong, and nobody is reading the logs then.
for entry in [base] + list(esplora.get('FALLBACK') or []):
    host = entry.split('//')[-1].split('/')[0].split(':')[0]
    if not entry.startswith('/') and host not in ('127.0.0.1', 'localhost', '::1', '[::1]'):
        print(f'address source {entry} is not infrastructure this host operates')
        sys.exit(1)

def get(path, raw=False):
    with urllib.request.urlopen(base + path, timeout=20) as answer:
        body = answer.read()
        return (body.decode().strip(), answer.headers) if raw else (json.loads(body), answer.headers)

try:
    height, headers = get('/blocks/tip/height', raw=True)
except (urllib.error.URLError, OSError) as error:
    print(f'the address index did not answer: {error}')
    sys.exit(1)

# The chain it indexed, not the chain it was told to index. A configuration
# pointed at the wrong network answers everything, and answers it wrong.
try:
    indexed_genesis, _ = get('/block-height/0', raw=True)
except Exception as error:
    print(f'the address index would not name its genesis block: {error}')
    sys.exit(1)
if indexed_genesis != genesis:
    print(f'the address index is on another chain: genesis {indexed_genesis}')
    sys.exit(1)

try:
    with urllib.request.urlopen('http://127.0.0.1:8996/api/v1/backend-info', timeout=20) as answer:
        core_tip = json.loads(answer.read())['chainSync']['blocks']
except Exception as error:
    print(f'could not read the Bitcoin Core height to compare against: {error}')
    sys.exit(1)

indexed_tip = int(height)
max_behind = int(esplora.get('MAX_BEHIND_TIP') or 2)
lag = core_tip - indexed_tip
if lag > max_behind:
    print(f'the address index is at block {indexed_tip} of {core_tip}, {lag} behind, and may be at most {max_behind}')
    sys.exit(1)

# The three questions an address page actually asks. A tip alone proves the
# block index; it proves nothing about the history and UTXO indexes the page
# is made of.
summary, _ = get(f'/address/{probe}')
if summary.get('address') != probe or not isinstance(summary.get('chain_stats', {}).get('tx_count'), int):
    print('the address summary query did not return a usable document')
    sys.exit(1)

history, _ = get(f'/address/{probe}/txs')
if not isinstance(history, list) or not history:
    print('the address history query returned nothing for an address that has history')
    sys.exit(1)

utxos, _ = get(f'/address/{probe}/utxo')
if not isinstance(utxos, list):
    print('the UTXO query did not return a list')
    sys.exit(1)

powered_by = headers.get('X-Powered-By') or 'unnamed'
print(f'address index {powered_by} at block {indexed_tip} of {core_tip}, summary, history and UTXO all answered')
PYGATE
  log "the first-party address index answered real address, history and UTXO queries"
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
  python3 - "$dir" "$CONF/overlay.env" "$OVERLAY/api/v1/universe/protocols" <<'PY' \
    || fail "the readable protocol authority gate could not be completed"
import json, sys, subprocess

_, env_file, protocol_url = sys.argv[1:]
env = {}
for line in open(env_file, encoding='utf-8'):
    if '=' in line and not line.startswith('#'):
        key, value = line.rstrip('\n').split('=', 1)
        env[key] = value
raw = env.get('UNIVERSE_EXPLORER_SOURCES_JSON', '')
configured = {s['authorityId'] for s in (json.loads(raw) if raw else [])}

out = subprocess.run(
    ['curl', '-fsS', '-m', '10', protocol_url],
    capture_output=True, text=True)
if out.returncode != 0:
    print(f'overlay protocol manifest could not be read: curl exited {out.returncode}')
    sys.exit(1)
if not out.stdout.strip():
    print('overlay protocol manifest was empty')
    sys.exit(1)

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

# The listener gate.
#
# index-doge-tap shipped with HOST=0.0.0.0 and answered /ready to the public
# internet for as long as it ran, on a host whose firewall is inactive. Nothing
# caught it: every functional check reached the service over loopback, where it
# behaved perfectly, and no gate ever asked which interface it was answering
# on.
#
# This one asks. It reads the listening sockets, subtracts the ones this
# deployment is supposed to expose, and refuses the cutover if anything is
# left. A service that has to be reachable from another host is added to
# PUBLIC_LISTENERS deliberately, with a reason, rather than discovered in
# production.
PUBLIC_LISTENERS="22 8333 50001"

gate_private_listeners() {
  command -v ss >/dev/null 2>&1 || fail "ss is not available, so the listener gate cannot run"

  local allowed
  allowed=$(printf '%s
' $PUBLIC_LISTENERS)

  # Every listening TCP socket that is not on a loopback address. Docker's
  # bridge address is treated as private: it is reachable only from containers
  # on this host, and the services behind it are the same ones loopback serves.
  local exposed
  exposed=$(ss -ltn 2>/dev/null     | awk 'NR > 1 { print $4 }'     | grep -vE '^(127\.|\[::1\]|172\.17\.0\.1:)'     | sed -E 's/.*:([0-9]+)$/\1/'     | sort -u)

  local unexpected=""
  local port
  for port in $exposed; do
    printf '%s
' "$allowed" | grep -qx "$port" || unexpected="$unexpected $port"
  done

  if [ -n "$unexpected" ]; then
    printf 'These ports answer on a public interface and are not declared:%s
' "$unexpected" >&2
    printf 'Bind the service to 127.0.0.1, or add the port to PUBLIC_LISTENERS with a reason.
' >&2
    ss -ltnp 2>/dev/null | grep -vE '127\.|\[::1\]' >&2 || true
    fail "a service is listening on a public interface"
  fi

  log "no unexpected public listener: only$(printf ' %s' $PUBLIC_LISTENERS) answer off loopback"
}

verify_overlay_v2() {
  local origin=$1 sha=$2
  node - "$origin" "$sha" <<'NODE'
const [origin, expectedSha] = process.argv.slice(2);

async function read(path, expectedStatus) {
  const response = await fetch(origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${path} returned ${response.status}, expected ${expectedStatus}.`);
  }
  return response;
}

const networks = await (await read(
  '/api/v2/universe/portfolio/networks',
  200,
)).json();
if (networks.schemaVersion !== 'universe-portfolio-v2-networks-v1') {
  throw new Error('Portfolio v2 returned the wrong networks schema.');
}
if (networks.contractVersion !== '2') {
  throw new Error('Portfolio v2 returned the wrong contract version.');
}
if (networks.releaseSha !== expectedSha) {
  throw new Error(
    `Portfolio v2 reported ${networks.releaseSha} instead of ${expectedSha}.`,
  );
}
if (!Array.isArray(networks.networks) || networks.networks.length === 0) {
  throw new Error('Portfolio v2 returned no supported networks.');
}
await read('/v2/universe/portfolio/networks', 404);
NODE
  log "Portfolio v2 at $origin reports required overlay $sha"
}

verify_overlay_identity() {
  local origin=$1 sha=$2
  node - "$origin" "$sha" <<'NODE'
const [origin, expectedSha] = process.argv.slice(2);
const response = await fetch(origin + '/api/v1/bitcoin/status?network=mainnet', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
});
if (response.status !== 200) throw new Error(`Bitcoin status returned ${response.status}.`);
const body = await response.json();
if (body?.release?.sha !== expectedSha) {
  throw new Error(`Bitcoin status reported ${String(body?.release?.sha)} instead of ${expectedSha}.`);
}
NODE
}

verify_overlay_v2_hidden() {
  local origin=$1
  node - "$origin" <<'NODE'
const origin = process.argv[2];
const response = await fetch(origin + '/api/v2/universe/portfolio/networks', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
});
if (response.status !== 404) {
  throw new Error(`Portfolio v2 returned ${response.status}, expected 404.`);
}
NODE
}

gate_gateway_overlay_control() {
  node - "$GATEWAY" <<'NODE'
const origin = process.argv[2];
const response = await fetch(origin + '/__gateway/overlay-route', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
});
if (response.status !== 200) throw new Error(`Gateway route control returned ${response.status}.`);
const body = await response.json();
if (body?.schemaVersion !== 'universe-overlay-route-v1' || body?.dynamic !== true) {
  throw new Error('Gateway does not support atomic overlay route changes.');
}
NODE
}

gateway_portfolio_v2() {
  node - "$GATEWAY" <<'NODE'
const origin = process.argv[2];
const response = await fetch(origin + '/__gateway/overlay-route', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
});
if (response.status !== 200) throw new Error(`Gateway route control returned ${response.status}.`);
const body = await response.json();
if (
  body?.schemaVersion !== 'universe-overlay-route-v1' || body?.dynamic !== true ||
  typeof body?.portfolioV2 !== 'boolean'
) throw new Error('Gateway does not expose a valid dynamic Portfolio v2 state.');
process.stdout.write(body.portfolioV2 ? 'true' : 'false');
NODE
}

write_gateway_overlay_route() {
  local sha=$1 portfolio_v2=$2 route_dir temp
  validate_full_sha "$sha"
  route_dir=$(dirname "$GATEWAY_ROUTE_FILE")
  install -d -o root -g universe-explorer -m 0750 "$route_dir"
  temp=$(mktemp "$route_dir/.overlay-route.XXXXXX")
  trap 'rm -f "$temp"' EXIT
  if ! node - "$OVERLAY" "$sha" "$portfolio_v2" > "$temp" <<'NODE'
const [origin, releaseSha, portfolioText] = process.argv.slice(2);
const parsed = new URL(origin);
if (!/^[0-9a-f]{40}$/.test(releaseSha)) throw new Error('Invalid overlay release SHA.');
if (
  parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' ||
  !parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash ||
  parsed.username || parsed.password
) throw new Error('Invalid overlay origin.');
if (!['true', 'false'].includes(portfolioText)) throw new Error('Invalid Portfolio v2 state.');
process.stdout.write(JSON.stringify({
  schemaVersion: 'universe-overlay-route-v1',
  slot: 'live',
  origin: parsed.origin,
  releaseSha,
  portfolioV2: portfolioText === 'true',
}) + '\n');
NODE
  then
    rm -f "$temp"
    trap - EXIT
    return 1
  fi
  chown root:universe-explorer "$temp" \
    || { rm -f "$temp"; trap - EXIT; return 1; }
  chmod 0640 "$temp" \
    || { rm -f "$temp"; trap - EXIT; return 1; }
  mv -f "$temp" "$GATEWAY_ROUTE_FILE" \
    || { rm -f "$temp"; trap - EXIT; return 1; }
  trap - EXIT
}

verify_gateway_overlay_route() {
  local sha=$1 portfolio_v2=$2
  node - "$GATEWAY" "$sha" "$portfolio_v2" <<'NODE'
const [origin, expectedSha, portfolioText] = process.argv.slice(2);
const response = await fetch(origin + '/__gateway/overlay-route', {
  redirect: 'manual',
  signal: AbortSignal.timeout(10_000),
});
if (response.status !== 200) throw new Error(`Gateway route control returned ${response.status}.`);
const body = await response.json();
if (
  body?.schemaVersion !== 'universe-overlay-route-v1' || body?.dynamic !== true ||
  body?.slot !== 'live' || body?.releaseSha !== expectedSha ||
  body?.portfolioV2 !== (portfolioText === 'true')
) throw new Error('Gateway route state does not match the paired release.');
NODE
}

set_gateway_portfolio_v2() {
  local sha=$1 portfolio_v2=$2
  validate_full_sha "$sha"
  gate_gateway_overlay_control || return 1
  verify_overlay_identity "$OVERLAY" "$sha" \
    || fail "the direct overlay does not report required release $sha"
  if [ "$portfolio_v2" = true ]; then
    verify_overlay_v2 "$OVERLAY" "$sha" \
      || fail "the required direct overlay does not satisfy Portfolio v2"
  fi
  write_gateway_overlay_route "$sha" "$portfolio_v2"
  verify_gateway_overlay_route "$sha" "$portfolio_v2" \
    || fail "the gateway did not apply the paired overlay route state"
  verify_overlay_identity "$GATEWAY" "$sha" \
    || fail "the gateway routes to the wrong overlay release"
  if [ "$portfolio_v2" = true ]; then
    verify_overlay_v2 "$GATEWAY" "$sha" \
      || fail "the gateway did not expose the paired Portfolio v2 contract"
  else
    verify_overlay_v2_hidden "$GATEWAY" \
      || fail "the gateway did not hide Portfolio v2 before Explorer rollback"
  fi
}

gate_required_overlay_direct() {
  [ -n "$REQUIRED_OVERLAY_SHA" ] || return 0
  validate_full_sha "$REQUIRED_OVERLAY_SHA"
  verify_overlay_identity "$OVERLAY" "$REQUIRED_OVERLAY_SHA" \
    || fail "the direct overlay reports the wrong release identity"
  verify_overlay_v2 "$OVERLAY" "$REQUIRED_OVERLAY_SHA" \
    || fail "the required overlay is not ready on its direct origin"
}

cmd_preflight() {
  local sha=$1
  validate_full_sha "$sha"
  local dir; dir=$(release_dir "$sha")
  [ -d "$dir" ] || fail "no release at $dir"
  gate_release_present "$dir"
  gate_manifest_exact "$dir" "$sha"
  gate_configuration
  gate_database
  gate_address_backend
  gate_sources_parse
  gate_private_listeners
  gate_readable_protocols_have_authorities "$dir"
  gate_required_overlay_direct
  log "preflight passed for $sha"
}

# ---------------------------------------------------------------- cutover ----

# Waits for a URL to answer 200 within a bounded time. On timeout the log
# names the last observed state, because a service that answered 503 for five
# minutes and one that never accepted a connection are different faults and
# are repaired differently. WAIT_FOR_SECONDS exists so a test can prove the
# timeout path without holding a runner for five minutes.
wait_for() {
  local url=$1 name=$2 timeout=${WAIT_FOR_SECONDS:-300} last=""
  local deadline=$((SECONDS + timeout))
  while [ $SECONDS -lt $deadline ]; do
    last=$(curl -sS -o /dev/null -m 5 -w '%{http_code}' "$url" 2>/dev/null || true)
    if [ "$last" = 200 ]; then
      log "$name is answering"
      return 0
    fi
    sleep 2
  done
  case "$last" in
    ''|000) last="no HTTP response (connection refused, unreachable, or timed out)" ;;
    *)      last="HTTP $last" ;;
  esac
  log "$name did not answer 200 within ${timeout}s; last observed state: $last"
  return 1
}

# Returns non-zero rather than exiting, so a failed check can be rolled back
# instead of leaving the new release in place with nothing serving.
verify_live() {
  local dir=$1 required_overlay_sha=${2-$REQUIRED_OVERLAY_SHA}
  wait_for "$GATEWAY/__gateway/health" gateway       || { log "gateway did not come back"; return 1; }
  wait_for "$BACKEND/api/v1/backend-info" backend    || { log "backend did not come back"; return 1; }
  wait_for "$OVERLAY/api/v1/universe/status" overlay || { log "overlay did not come back"; return 1; }

  local served
  served=$(curl -sS -m 10 "$BACKEND/api/v1/backend-info" | python3 -c 'import json,sys; print(json.load(sys.stdin)["gitCommit"])')
  log "backend reports $served"

  # A public feature must not be advertised by a backend that did not mount its
  # routes. This is the exact failure that shipped last time.
  python3 - "$BACKEND" <<'PY' || return 1
import json, os, subprocess, sys, time
# A backend answers /backend-info the moment its HTTP server is listening,
# which is what the wait above proves. The capability report needs more
# than that: it describes the address index, and describing it means
# having reached the Electrum server first. On a cold start that
# connection lands tens of seconds after the port opens, so a single
# ten second read asked a backend that was still connecting, gave up,
# and rolled a good release back. Measured on this host: the report was
# requested at 17:17:04 and the backend logged its Electrum connection
# at 17:17:26.
#
# So this waits for the report the way everything else here waits for a
# service, rather than asking once and calling a warming backend broken.
deadline = time.monotonic() + float(os.environ.get('CAPABILITY_WAIT_SECONDS', '180'))
report = None
last = 'no attempt was made'
while time.monotonic() < deadline:
    answer = subprocess.run(
        ['curl', '-fsS', '-m', '15', sys.argv[1] + '/api/v1/capabilities'],
        capture_output=True, text=True)
    if answer.returncode != 0:
        last = f'curl exited {answer.returncode}: ' + (answer.stderr or '').strip()[:120]
    elif not answer.stdout.strip():
        last = 'the backend answered with an empty body'
    else:
        try:
            candidate = json.loads(answer.stdout)
            if not isinstance(candidate, dict) or not isinstance(candidate.get('features'), dict):
                last = 'the answer did not contain a feature report'
            else:
                report = candidate
                break
        except json.JSONDecodeError as error:
            last = f'the answer was not JSON: {error}'
    time.sleep(3)
if report is None:
    print('the capability report could not be read; last attempt: ' + last)
    sys.exit(1)
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

  gate_live_socket || return 1
  gate_live_address || return 1
  gate_component_identity "$dir" || return 1
  if [ -n "$required_overlay_sha" ]; then
    validate_full_sha "$required_overlay_sha"
    verify_overlay_v2 "$GATEWAY" "$required_overlay_sha" || return 1
  fi
}

# The public address contract, asked for through the gateway, after the switch.
#
# Everything above this proves the components came back and that the capability
# report is internally consistent. None of it opens the path a reader takes to
# an address page, which is exactly the path that was broken while every gate
# was green: the gateway sent `/api/address/...` to a backend that answered
# 405, and nothing in the release ever asked it for an address.
#
# The verdict on readiness comes from the capability document rather than being
# recomputed here, so the deployment and the gate cannot form different
# opinions about what ready means. What is checked in addition is the thing a
# document cannot tell you: that the route in front of it works, and that the
# process answering it is the one that is supposed to.
gate_live_address() {
  python3 - "$GATEWAY" "$BACKEND" "$ADDRESS_PROBE" <<'PYADDRESS' || return 1
import json, sys, urllib.request, urllib.error

gateway, backend, probe = sys.argv[1], sys.argv[2], sys.argv[3]

def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url), timeout=25) as answer:
            return answer.status, answer.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except (urllib.error.URLError, OSError) as error:
        print(f'{url} could not be reached: {error}')
        return None, b''

status, body = fetch(backend + '/api/v1/capabilities')
if status != 200:
    print('the capability report could not be read')
    sys.exit(1)
address = json.loads(body)['features'].get('addressLookup')
if address is None:
    # A release from before this capability existed cannot report it. That is
    # the normal case when rolling back, and it is the worst possible moment to
    # raise a false alarm, so the functional checks below decide instead. They
    # ask the origin the same questions a browser does and need no self report.
    print('this release predates the address capability; judging it by what it serves')
elif address['state'] != 'ready':
    print(f"address lookup is {address['state']}: {address.get('degradedReason')}")
    sys.exit(1)
else:
    print(f"address lookup is ready on {address.get('backendKind')} "
          f"at block {address.get('indexedTip')} of {address.get('bitcoinCoreTip')}")

# Summary, first history page, and UTXOs, through the gateway, exactly as a
# reader's browser asks for them.
status, body = fetch(f'{gateway}/api/address/{probe}')
if status != 200:
    print(f'the address summary answered {status} through the gateway')
    sys.exit(1)
summary = json.loads(body)
if summary.get('address') != probe:
    print('the address summary is about a different address than the one asked for')
    sys.exit(1)
for section in ('chain_stats', 'mempool_stats'):
    stats = summary.get(section) or {}
    for field in ('funded_txo_count', 'funded_txo_sum', 'spent_txo_count', 'spent_txo_sum', 'tx_count'):
        if not isinstance(stats.get(field), int):
            print(f'{section}.{field} is {stats.get(field)!r} rather than a whole number')
            sys.exit(1)

status, body = fetch(f'{gateway}/api/address/{probe}/txs')
if status != 200:
    print(f'the address history answered {status} through the gateway')
    sys.exit(1)
history = json.loads(body)
if not isinstance(history, list) or not history:
    print('the address history came back empty for an address that has history')
    sys.exit(1)
for transaction in history:
    if len(transaction.get('txid', '')) != 64:
        print('a history entry does not name a transaction')
        sys.exit(1)

status, body = fetch(f'{gateway}/api/address/{probe}/utxo')
if status != 200:
    print(f'the UTXO query answered {status} through the gateway')
    sys.exit(1)
if not isinstance(json.loads(body), list):
    print('the UTXO query did not return a list')
    sys.exit(1)

# Which process answered. In this configuration the explorer backend
# deliberately does not mount the address family, so if it answers this at all
# the gateway is sending address traffic to the wrong upstream and the 200s
# above came from the wrong place.
if address is not None and address.get('backendKind') == 'esplora':
    status, _ = fetch(f'{backend}/api/v1/address/{probe}')
    if status == 200:
        print('the explorer backend served an address lookup, so the gateway is routing /api/ to it '
              'rather than to the index')
        sys.exit(1)

print('the public address contract answers through the gateway: summary, history and UTXOs')
PYADDRESS
}

# The three components behind this origin, held to what the release says they
# should be.
#
# The checks above prove the backend came back and that its enabled features
# have routes. They say nothing about whether the frontend beside it comes from
# the same release, which is how this origin went on serving a frontend
# forty-three commits behind for a day with every check green, and nothing
# about whether the overlay can name itself, which is how "Release development"
# reached the public.
#
# The overlay is not pinned by the manifest. It is built from another
# repository on its own release train, so what is required of it is the
# contract this frontend reads and an identity it can state.
gate_component_identity() {
  local dir=$1
  [ -f "$dir/RELEASE-MANIFEST.json" ] || { log "release carries no manifest"; return 1; }
  node "$dir/scripts/universe/release-manifest.mjs" verify \
    --manifest="$dir/RELEASE-MANIFEST.json" --origin="$GATEWAY"
}

# The live socket, asked for the way a browser asks for it.
#
# The overlay refuses an upgrade whose Origin is not on its allowlist, and an
# unset allowlist refuses every origin. A handshake sent without an Origin
# header is allowed, so curl said the socket worked while every browser was
# refused and fell back to polling: the page still updated, and nothing on the
# server said no. Send the header a browser sends.
gate_live_socket() {
  python3 - "$GATEWAY" <<'PY' || return 1
import socket, sys
from urllib.parse import urlsplit

target = urlsplit(sys.argv[1])
host, port = target.hostname, target.port or 80
request = (
    'GET /api/v1/universe/ws HTTP/1.1\r\n'
    f'Host: {host}:{port}\r\n'
    'Connection: Upgrade\r\n'
    'Upgrade: websocket\r\n'
    'Sec-WebSocket-Version: 13\r\n'
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
    'Origin: https://explorer.bitcoinuniverse.io\r\n'
    '\r\n'
)
try:
    with socket.create_connection((host, port), timeout=10) as connection:
        connection.sendall(request.encode())
        status = connection.recv(4096).split(b'\r\n', 1)[0].decode(errors='replace')
except OSError as error:
    print(f'the live socket could not be reached: {error}')
    sys.exit(1)
if '101' not in status:
    print(f'the live socket refused a browser handshake: {status}')
    print('set CORS_ORIGINS in the overlay environment to the public origin')
    sys.exit(1)
print('the live socket accepts a browser handshake')
PY
}

restore_cutover_previous() {
  local previous=$1 previous_sha=$2 mode=$3 previous_portfolio=$4 verify_overlay_sha=''
  validate_full_sha "$previous_sha"
  [ "$previous_portfolio" = true ] || [ "$previous_portfolio" = false ] \
    || fail "cannot restore an invalid prior Portfolio v2 state"

  # Restore the route file before a replacement gateway can read it. The
  # pre-baseline gateway ignores this file, but leaving an explicit false state
  # makes the next socket-held baseline attempt deterministic after reboot.
  write_gateway_overlay_route "$REQUIRED_OVERLAY_SHA" "$previous_portfolio"
  ln -sfn "$previous" "$CURRENT.rollback" \
    || fail "could not prepare the previous Explorer release link"
  mv -Tf "$CURRENT.rollback" "$CURRENT" \
    || fail "could not restore the previous Explorer release link"

  # The newer gateway is compatible with the previous backend. Restore the
  # backend first, then restore gateway code, so recovery never creates the
  # unsafe old-gateway/new-backend combination.
  systemctl restart universe-explorer-backend \
    || fail "the previous Explorer backend could not restart"
  systemctl restart universe-explorer-gateway \
    || fail "the previous Explorer gateway could not restart"
  if [ "$mode" != --gateway-baseline ] && [ "$previous_portfolio" = true ]; then
    verify_overlay_sha=$REQUIRED_OVERLAY_SHA
  fi
  verify_live "$previous" "$verify_overlay_sha" \
    || fail "the previous Explorer release did not recover"
  verify_overlay_identity "$GATEWAY" "$REQUIRED_OVERLAY_SHA" \
    || fail "the previous gateway recovered with the wrong overlay identity"
  if [ "$previous_portfolio" = false ]; then
    verify_overlay_v2_hidden "$GATEWAY" \
      || fail "the previous gateway did not restore hidden Portfolio v2 state"
  fi

  if [ "$mode" != --gateway-baseline ]; then
    verify_gateway_overlay_route "$REQUIRED_OVERLAY_SHA" "$previous_portfolio" \
      || fail "the previous gateway did not recover its exact overlay route state"
  fi
  log "restored exact previous Explorer release $previous_sha"
}

gate_gateway_baseline_tree() {
  local previous=$1 target=$2 differences status expected
  set +e
  differences=$(diff -qr "$previous/frontend/build" "$target/frontend/build")
  status=$?
  set -e
  [ "$status" -le 1 ] || fail "could not compare the gateway baseline frontend"
  expected="Files $previous/frontend/build/resources/config.js and $target/frontend/build/resources/config.js differ"
  [ -z "$differences" ] || [ "$differences" = "$expected" ] \
    || fail "gateway baseline target changes frontend behavior; use a gateway-only baseline artifact"

  diff -qr "$previous/backend/dist" "$target/backend/dist" >/dev/null \
    || fail "gateway baseline target changes backend behavior; use a gateway-only baseline artifact"
  cmp -s "$previous/backend/package-lock.json" "$target/backend/package-lock.json" \
    || fail "gateway baseline target changes backend dependencies"
  diff -qr "$previous/backend/node_modules" "$target/backend/node_modules" >/dev/null \
    || fail "gateway baseline target changes the production dependency tree"
}

cmd_cutover() {
  local sha=$1 mode=${2:-} verify_overlay_sha=$REQUIRED_OVERLAY_SHA previous_portfolio=false
  local dir; dir=$(release_dir "$sha")
  validate_full_sha "$sha"
  [ -z "$mode" ] || [ "$mode" = --gateway-baseline ] \
    || fail "cutover accepts only the optional --gateway-baseline flag"
  [ -n "$REQUIRED_OVERLAY_SHA" ] \
    || fail "set UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA to the live overlay's full commit"
  validate_full_sha "$REQUIRED_OVERLAY_SHA"
  if [ "$mode" = --gateway-baseline ]; then
    verify_overlay_identity "$OVERLAY" "$REQUIRED_OVERLAY_SHA" \
      || fail "the baseline migration requires the exact current overlay identity"
    REQUIRED_OVERLAY_SHA='' cmd_preflight "$sha"
    verify_overlay_sha=''
  else
    cmd_preflight "$sha"
  fi

  local previous previous_sha
  previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [ -n "$previous" ] || fail "current release link is missing"
  [ "$(dirname "$previous")" = "$RELEASES" ] \
    || fail "current release points outside $RELEASES"
  case "$(basename "$previous")" in
    mempool-*) ;;
    *) fail "current release points outside $RELEASES" ;;
  esac
  previous_sha=$(basename "$previous" | sed 's/^mempool-//')
  validate_full_sha "$previous_sha"
  gate_release_present "$previous"
  gate_manifest_exact "$previous" "$previous_sha"
  log "previous release: ${previous:-none}"

  # The backend runs from a path baked into its unit at exec time, so it must
  # restart and the gateway bridges that. The overlay has its own release link
  # and release script, so this cutover must not restart or change it. The
  # gateway resolves its static root per request, so a frontend change reaches
  # it through the symlink with no restart at all, and it is restarted only
  # when its own code changed.
  #
  # That restart used to be the one part of a deploy nothing could bridge. It
  # is seamless when universe-explorer-gateway.socket owns the port, because
  # systemd keeps it bound and arriving connections queue rather than being
  # refused. Every cutover requires that socket to be active, and a changed
  # gateway relies on it while its process restarts.
  local gateway_changed=no
  if [ -n "$previous" ] && [ -f "$previous/scripts/universe/gateway.mjs" ]; then
    if ! cmp -s "$previous/scripts/universe/gateway.mjs" "$dir/scripts/universe/gateway.mjs"; then
      gateway_changed=yes
    fi
  else
    gateway_changed=yes
  fi

  if [ "$mode" = --gateway-baseline ]; then
    [ "$gateway_changed" = yes ] \
      || fail "gateway baseline mode requires a changed gateway"
    grep -q "universe-overlay-route-v1" "$dir/scripts/universe/gateway.mjs" \
      || fail "gateway baseline target does not implement dynamic overlay routing"
    gate_gateway_baseline_tree "$previous" "$dir"
  fi

  if ! systemctl is-active --quiet universe-explorer-gateway.socket; then
    fail "universe-explorer-gateway.socket is not active; refusing a cutover that could interrupt the origin"
  fi

  if [ "$mode" != --gateway-baseline ]; then
    previous_portfolio=$(gateway_portfolio_v2) \
      || fail "the current gateway does not expose its Portfolio v2 state"
    # Publish the additive API before a frontend that depends on it can serve.
    # The current gateway must already implement dynamic route state.
    set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" true
  fi

  if ! ln -sfn "$dir" "$CURRENT.new" || ! mv -Tf "$CURRENT.new" "$CURRENT"; then
    restore_cutover_previous "$previous" "$previous_sha" "$mode" "$previous_portfolio"
    fail "could not switch the Explorer release link"
  fi
  log "current now points at $dir"

  # The gateway goes first, and the order is not arbitrary.
  #
  # A release may move which upstream owns a path. Adopting the Esplora index
  # did exactly that: the explorer backend stops mounting the address,
  # transaction, block and mempool routes and the index starts serving them.
  # The two directions are not symmetric across that kind of change.
  #
  #   new gateway, old backend  ->  fine. The new table sends /api/ to the
  #                                 index, which is already up, and /api/v1/
  #                                 to the backend, which still answers it.
  #   old gateway, new backend  ->  broken. The old table sends /api/ to a
  #                                 backend that no longer mounts it, so every
  #                                 transaction, block and address page 404s.
  #
  # Restarting the backend first puts the origin through the broken half for
  # as long as the backend takes to come up. Restarting the gateway first
  # never does, because the new table is correct against both. Its socket unit
  # holds the port across its own restart, so this costs nothing.
  if [ "$gateway_changed" = yes ]; then
    log "the gateway changed, restarting it first; systemd holds the port, so the origin sees no refused connection"
    if ! systemctl restart universe-explorer-gateway; then
      log "the changed gateway could not restart, rolling back"
      if [ -n "$previous" ]; then
        restore_cutover_previous "$previous" "$previous_sha" "$mode" "$previous_portfolio"
      fi
      fail "the changed gateway could not restart"
    fi
    if ! wait_for "$GATEWAY/__gateway/health" gateway; then
      log "the changed gateway did not become healthy, rolling back"
      if [ -n "$previous" ]; then
        restore_cutover_previous "$previous" "$previous_sha" "$mode" "$previous_portfolio"
      fi
      fail "the changed gateway did not become healthy after restart"
    fi
  else
    log "the gateway is unchanged, leaving it up so the origin sees no gap"
  fi

  if [ "$mode" = --gateway-baseline ]; then
    # This runs only after the socket-held new gateway is healthy. The route
    # stays hidden, so the byte-identical current frontend has no new contract.
    set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" false
  fi

  if ! systemctl restart universe-explorer-backend; then
    log "the explorer backend could not restart, rolling back"
    restore_cutover_previous "$previous" "$previous_sha" "$mode" "$previous_portfolio"
    fail "the explorer backend could not restart"
  fi
  if ! verify_live "$dir" "$verify_overlay_sha"; then
    log "verification failed, rolling back"
    restore_cutover_previous "$previous" "$previous_sha" "$mode" "$previous_portfolio"
    fail "cutover verification failed"
  fi
  log "cutover to $sha complete"
}

cmd_rollback() {
  local sha=$1
  validate_full_sha "$sha"
  local dir; dir=$(release_dir "$sha")
  local previous previous_sha previous_portfolio gateway_changed=no verify_overlay_sha=''
  [ -d "$dir" ] || fail "no release at $dir to roll back to"
  [ -n "$REQUIRED_OVERLAY_SHA" ] \
    || fail "set UNIVERSE_EXPLORER_REQUIRED_OVERLAY_SHA before paired rollback"
  validate_full_sha "$REQUIRED_OVERLAY_SHA"
  gate_release_present "$dir"
  gate_manifest_exact "$dir" "$sha"
  grep -q "universe-overlay-route-v1" "$dir/scripts/universe/gateway.mjs" \
    || fail "rollback target predates safe paired overlay routing"
  systemctl is-active --quiet universe-explorer-gateway.socket \
    || fail "gateway socket is not active; paired rollback would open an availability gap"

  previous=$(readlink -f "$CURRENT" 2>/dev/null || true)
  [ -n "$previous" ] || fail "current release link is missing"
  [ "$(dirname "$previous")" = "$RELEASES" ] \
    || fail "current release points outside $RELEASES"
  case "$(basename "$previous")" in
    mempool-*) ;;
    *) fail "current release points outside $RELEASES" ;;
  esac
  previous_sha=$(basename "$previous" | sed 's/^mempool-//')
  validate_full_sha "$previous_sha"
  gate_release_present "$previous"
  gate_manifest_exact "$previous" "$previous_sha"
  previous_portfolio=$(gateway_portfolio_v2) \
    || fail "the current gateway does not expose its Portfolio v2 state"
  verify_gateway_overlay_route "$REQUIRED_OVERLAY_SHA" "$previous_portfolio" \
    || fail "the current gateway route does not match the required overlay"
  verify_overlay_identity "$GATEWAY" "$REQUIRED_OVERLAY_SHA" \
    || fail "the current gateway routes to the wrong overlay release"

  if ! cmp -s "$previous/scripts/universe/gateway.mjs" "$dir/scripts/universe/gateway.mjs"; then
    gateway_changed=yes
  fi

  # Keep the current API state while the rollback frontend and backend become
  # healthy. The newer gateway is compatible with the older backend, so the
  # backend moves first. A changed gateway moves only after that backend is up.
  if ! ln -sfn "$dir" "$CURRENT.new" || ! mv -Tf "$CURRENT.new" "$CURRENT"; then
    restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"
    fail "could not switch to the Explorer rollback link"
  fi
  if ! systemctl restart universe-explorer-backend; then
    restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"
    fail "the Explorer rollback backend could not restart"
  fi
  if [ "$gateway_changed" = yes ]; then
    if ! systemctl restart universe-explorer-gateway; then
      restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"
      fail "the Explorer rollback gateway could not restart"
    fi
    if ! wait_for "$GATEWAY/__gateway/health" gateway; then
      restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"
      fail "the Explorer rollback gateway did not become healthy"
    fi
  fi
  if [ "$previous_portfolio" = true ]; then
    verify_overlay_sha=$REQUIRED_OVERLAY_SHA
  fi
  if ! verify_live "$dir" "$verify_overlay_sha"; then
    restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"
    fail "the Explorer rollback target did not become healthy"
  fi
  verify_gateway_overlay_route "$REQUIRED_OVERLAY_SHA" "$previous_portfolio" \
    || { restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"; fail "the Explorer rollback target lost the prior overlay route state"; }
  verify_overlay_identity "$GATEWAY" "$REQUIRED_OVERLAY_SHA" \
    || { restore_cutover_previous "$previous" "$previous_sha" normal "$previous_portfolio"; fail "rollback gateway routes to the wrong overlay release"; }

  # Only a proven rollback frontend may remove the additive API. The overlay
  # rollback command follows and refuses to run until it observes this state.
  set_gateway_portfolio_v2 "$REQUIRED_OVERLAY_SHA" false
  log "rolled back to $sha"
}

acquire_deploy_lock() {
  command -v flock >/dev/null 2>&1 || fail "flock is required for release operations"
  install -d -m 0755 "$(dirname "$DEPLOY_LOCK")"
  exec 9>"$DEPLOY_LOCK"
  flock -n 9 || fail "another Universe Explorer release operation holds $DEPLOY_LOCK"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  acquire_deploy_lock
  case "${1:-}" in
    install)   cmd_install "$2" "$3" ;;
    preflight) cmd_preflight "$2" ;;
    cutover)   cmd_cutover "$2" "${3:-}" ;;
    rollback)  cmd_rollback "$2" ;;
    *) fail "usage: release.sh {install <full-sha> <tarball>|preflight <full-sha>|cutover <full-sha> [--gateway-baseline]|rollback <full-sha>}" ;;
  esac
fi
