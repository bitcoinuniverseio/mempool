#!/bin/sh
__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__=${BACKEND_MAINNET_HTTP_HOST:=127.0.0.1}
__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__=${BACKEND_MAINNET_HTTP_PORT:=8999}
__MEMPOOL_FRONTEND_HTTP_PORT__=${FRONTEND_HTTP_PORT:=8080}

# File locations, overridable so the rendering can be exercised outside the image.
__NGINX_ETC__=${NGINX_ETC:=/etc/nginx}
__PATCH_DIR__=${PATCH_DIR:=/patch}
__MEMPOOL_WWW__=${MEMPOOL_WWW:=/var/www/mempool}

# Runtime data comes from Bitcoin Universe infrastructure only. A services
# endpoint is empty, a same-origin /path, or an http(s) URL without
# credentials whose host is loopback, a single-label container name, or under
# bitcoinuniverse.io. Anything else stops the container before configuration
# is rendered; the value is not echoed, only the field name and, when it is not
# a credential problem, the host.
universe_endpoint_check() {
  name="$1"
  value="$2"
  extra="$3"
  [ -z "${value}" ] && return 0
  case "${value}" in
    /*) return 0 ;;
    http://*|https://*) ;;
    *)
      echo "entrypoint.sh: ${name} must be empty, a /path, or an http(s) URL; refusing to start" >&2
      return 1 ;;
  esac
  case "${value}" in
    *[\"\'\\\!\|\ \	]*)
      echo "entrypoint.sh: ${name} contains a character no endpoint URL uses (quote, backslash, space, ! or |); refusing to start" >&2
      return 1 ;;
  esac
  hostport=${value#*://}
  hostport=${hostport%%/*}
  case "${hostport}" in
    *@*)
      echo "entrypoint.sh: ${name} must not carry credentials in the URL; refusing to start" >&2
      return 1 ;;
  esac
  host=$(printf '%s' "${hostport%%:*}" | tr 'A-Z' 'a-z' | sed 's/\.*$//')
  case "${host}" in
    ""|*[!a-z0-9.-]*)
      echo "entrypoint.sh: ${name} has a malformed host; refusing to start" >&2
      return 1 ;;
    localhost|127.*|bitcoinuniverse.io|*.bitcoinuniverse.io) return 0 ;;
    mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion) ;; # origin-gate:deny
    *.onion) [ "${extra}" = "onion" ] && return 0 ;;
    *.*) ;;
    *) return 0 ;;
  esac
  echo "entrypoint.sh: ${name} points outside Bitcoin Universe infrastructure (host: ${host}); refusing to start" >&2
  return 1
}

# Proxying the services API through nginx needs an explicit owned host; the
# nginx template carries a __PROXIED_SERVICES_HOST__ placeholder where it
# offers that route.
__PROXIED_SERVICES__=${PROXIED_SERVICES:=false}
__PROXIED_SERVICES_HOST__=${PROXIED_SERVICES_HOST:=""}

if [ "${__PROXIED_SERVICES__}" = "true" ]; then
  if [ -z "${__PROXIED_SERVICES_HOST__}" ]; then
    echo "entrypoint.sh: PROXIED_SERVICES=true needs PROXIED_SERVICES_HOST (a Bitcoin Universe services origin); refusing to start" >&2
    exit 78
  fi
  universe_endpoint_check PROXIED_SERVICES_HOST "${__PROXIED_SERVICES_HOST__}" || exit 78
  sed -i "s|__PROXIED_SERVICES_HOST__|${__PROXIED_SERVICES_HOST__}|g" "${__NGINX_ETC__}/conf.d/nginx-mempool.conf"
fi

sed -i "s/__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__/${__MEMPOOL_BACKEND_MAINNET_HTTP_HOST__}/g" "${__NGINX_ETC__}/conf.d/nginx-mempool.conf"
sed -i "s/__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__/${__MEMPOOL_BACKEND_MAINNET_HTTP_PORT__}/g" "${__NGINX_ETC__}/conf.d/nginx-mempool.conf"

cp "${__NGINX_ETC__}/nginx.conf" "${__PATCH_DIR__}/nginx.conf"
sed -i "s/__MEMPOOL_FRONTEND_HTTP_PORT__/${__MEMPOOL_FRONTEND_HTTP_PORT__}/g" "${__PATCH_DIR__}/nginx.conf"
cat "${__PATCH_DIR__}/nginx.conf" > "${__NGINX_ETC__}/nginx.conf"

if [ "${LIGHTNING_DETECTED_PORT}" != "" ];then
  export LIGHTNING=true
fi

# Runtime overrides - read env vars defined in docker compose

__MAINNET_ENABLED__=${MAINNET_ENABLED:=true}
__TESTNET_ENABLED__=${TESTNET_ENABLED:=false}
__TESTNET4_ENABLED__=${TESTNET4_ENABLED:=false}
__SIGNET_ENABLED__=${SIGNET_ENABLED:=false}
__REGTEST_ENABLED__=${REGTEST_ENABLED:=false}
__LIQUID_ENABLED__=${LIQUID_ENABLED:=false}
__LIQUID_TESTNET_ENABLED__=${LIQUID_TESTNET_ENABLED:=false}
__ITEMS_PER_PAGE__=${ITEMS_PER_PAGE:=10}
__KEEP_BLOCKS_AMOUNT__=${KEEP_BLOCKS_AMOUNT:=8}
__NGINX_PROTOCOL__=${NGINX_PROTOCOL:=http}
__NGINX_HOSTNAME__=${NGINX_HOSTNAME:=localhost}
__NGINX_PORT__=${NGINX_PORT:=8999}
__BLOCK_WEIGHT_UNITS__=${BLOCK_WEIGHT_UNITS:=4000000}
__MEMPOOL_BLOCKS_AMOUNT__=${MEMPOOL_BLOCKS_AMOUNT:=8}
__BASE_MODULE__=${BASE_MODULE:=mempool}
__ROOT_NETWORK__=${ROOT_NETWORK:=}
__MEMPOOL_WEBSITE_URL__=${MEMPOOL_WEBSITE_URL:=https://explorer.bitcoinuniverse.io}
__LIQUID_WEBSITE_URL__=${LIQUID_WEBSITE_URL:=https://liquid.network}
__MINING_DASHBOARD__=${MINING_DASHBOARD:=true}
__LIGHTNING__=${LIGHTNING:=false}
__AUDIT__=${AUDIT:=false}
__MAINNET_BLOCK_AUDIT_START_HEIGHT__=${MAINNET_BLOCK_AUDIT_START_HEIGHT:=0}
__TESTNET_BLOCK_AUDIT_START_HEIGHT__=${TESTNET_BLOCK_AUDIT_START_HEIGHT:=0}
__SIGNET_BLOCK_AUDIT_START_HEIGHT__=${SIGNET_BLOCK_AUDIT_START_HEIGHT:=0}
__REGTEST_BLOCK_AUDIT_START_HEIGHT__=${REGTEST_BLOCK_AUDIT_START_HEIGHT:=0}
__TESTNET4_BLOCK_AUDIT_START_HEIGHT__=${TESTNET4_BLOCK_AUDIT_START_HEIGHT:=0}
__MAINNET_TX_FIRST_SEEN_START_HEIGHT__=${MAINNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__TESTNET_TX_FIRST_SEEN_START_HEIGHT__=${TESTNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__TESTNET4_TX_FIRST_SEEN_START_HEIGHT__=${TESTNET4_TX_FIRST_SEEN_START_HEIGHT:=0}
__SIGNET_TX_FIRST_SEEN_START_HEIGHT__=${SIGNET_TX_FIRST_SEEN_START_HEIGHT:=0}
__REGTEST_TX_FIRST_SEEN_START_HEIGHT__=${REGTEST_TX_FIRST_SEEN_START_HEIGHT:=0}
__ACCELERATOR__=${ACCELERATOR:=false}
__ACCELERATOR_BUTTON__=${ACCELERATOR_BUTTON:=true}
# Unset by default, matching the frontend: account and acceleration calls
# then never leave this origin. Name a Bitcoin Universe services endpoint to
# turn them on.
__SERVICES_API__=${SERVICES_API:=""}
universe_endpoint_check SERVICES_API "${__SERVICES_API__}" || exit 78
# The services endpoint used when this deployment is reached over Tor. Only
# an explicitly configured .onion host is used; the page hostname alone never
# switches providers.
__ONION_SERVICES_API__=${ONION_SERVICES_API:=""}
universe_endpoint_check ONION_SERVICES_API "${__ONION_SERVICES_API__}" onion || exit 78
__PUBLIC_ACCELERATIONS__=${PUBLIC_ACCELERATIONS:=false}
__HISTORICAL_PRICE__=${HISTORICAL_PRICE:=true}
__ADDITIONAL_CURRENCIES__=${ADDITIONAL_CURRENCIES:=false}
__STRATUM_ENABLED__=${STRATUM_ENABLED:=false}
# Which network each non-Bitcoin chain is read from, as a JSON object such as
# {"dogecoin":"testnet"}. Unlisted chains read mainnet; Bitcoin follows the
# network selector. The frontend parses this string.
__UNIVERSE_CHAIN_NETWORKS__=${UNIVERSE_CHAIN_NETWORKS:={}}

# Export as environment variables to be used by envsubst
export __MAINNET_ENABLED__
export __TESTNET_ENABLED__
export __TESTNET4_ENABLED__
export __SIGNET_ENABLED__
export __REGTEST_ENABLED__
export __LIQUID_ENABLED__
export __LIQUID_TESTNET_ENABLED__
export __ITEMS_PER_PAGE__
export __KEEP_BLOCKS_AMOUNT__
export __NGINX_PROTOCOL__
export __NGINX_HOSTNAME__
export __NGINX_PORT__
export __BLOCK_WEIGHT_UNITS__
export __MEMPOOL_BLOCKS_AMOUNT__
export __BASE_MODULE__
export __ROOT_NETWORK__
export __MEMPOOL_WEBSITE_URL__
export __LIQUID_WEBSITE_URL__
export __MINING_DASHBOARD__
export __LIGHTNING__
export __AUDIT__
export __MAINNET_BLOCK_AUDIT_START_HEIGHT__
export __TESTNET_BLOCK_AUDIT_START_HEIGHT__
export __SIGNET_BLOCK_AUDIT_START_HEIGHT__
export __REGTEST_BLOCK_AUDIT_START_HEIGHT__
export __TESTNET4_BLOCK_AUDIT_START_HEIGHT__
export __MAINNET_TX_FIRST_SEEN_START_HEIGHT__
export __TESTNET_TX_FIRST_SEEN_START_HEIGHT__
export __TESTNET4_TX_FIRST_SEEN_START_HEIGHT__
export __SIGNET_TX_FIRST_SEEN_START_HEIGHT__
export __REGTEST_TX_FIRST_SEEN_START_HEIGHT__
export __ACCELERATOR__
export __ACCELERATOR_BUTTON__
export __SERVICES_API__
export __ONION_SERVICES_API__
export __PUBLIC_ACCELERATIONS__
export __HISTORICAL_PRICE__
export __ADDITIONAL_CURRENCIES__
export __STRATUM_ENABLED__
export __UNIVERSE_CHAIN_NETWORKS__

folder=$(find "${__MEMPOOL_WWW__}" -name "config.js" | xargs dirname)
echo ${folder}
envsubst < ${folder}/config.template.js > ${folder}/config.js

exec "$@"
