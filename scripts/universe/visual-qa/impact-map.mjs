/**
 * Component-to-route and shared-surface impact mapping.
 *
 * Translates Git diff paths into the set of affected routes and scenarios.
 * Always includes baseline shared surfaces (home, nav, footer, chain selector,
 * dogecoin, zcash, btc tx, btc address).
 */

export const ALWAYS_INCLUDED_ROUTES = [
  'home',
  'chain-menu',
  'tx',
  'address',
  'dogecoin',
  'zcash',
];

export const INTELLIGENCE_ROUTES = [
  'intelligence-policy-lab',
  'intelligence-workbench',
  'intelligence-verify-proof',
  'intelligence-relay',
  'intelligence-time-machine',
  'intelligence-mining-templates',
  'intelligence-utxo-set',
  'intelligence-transaction-graph',
  'intelligence-incidents',
  'intelligence-knowledge',
  'intelligence-developers',
  'intelligence-query-studio',
  'intelligence-watchlists',
  'intelligence-protocols',
];

/**
 * Mapping of component file patterns to route IDs.
 */
export const COMPONENT_ROUTE_MAP = [
  // Shared navigation and layout
  { pattern: /app\/(components\/header|components\/footer|components\/nav)/, routes: ['home', 'chain-menu'] },
  { pattern: /app\/services\/state\.service/, routes: ['home', 'address', 'tx', 'dogecoin', 'zcash'] },

  // Bitcoin core routes
  { pattern: /app\/pages\/transaction/, routes: ['tx'] },
  { pattern: /app\/pages\/address/, routes: ['address'] },
  { pattern: /app\/pages\/block/, routes: ['block', 'blocks', 'mempool-block'] },
  { pattern: /app\/pages\/graphs/, routes: ['graphs'] },
  { pattern: /app\/pages\/mining/, routes: ['mining'] },

  // Chain dashboards
  { pattern: /app\/universe\/chain-dashboard/, routes: ['dogecoin', 'zcash'] },

  // Intelligence Platform components
  { pattern: /intelligence-platform\/policy-lab/, routes: ['intelligence-policy-lab'] },
  { pattern: /intelligence-platform\/script-workbench/, routes: ['intelligence-workbench'] },
  { pattern: /intelligence-platform\/verify-proof/, routes: ['intelligence-verify-proof'] },
  { pattern: /intelligence-platform\/relay-observatory/, routes: ['intelligence-relay'] },
  { pattern: /intelligence-platform\/time-machine/, routes: ['intelligence-time-machine'] },
  { pattern: /intelligence-platform\/mining-templates/, routes: ['intelligence-mining-templates'] },
  { pattern: /intelligence-platform\/utxo-intelligence/, routes: ['intelligence-utxo-set'] },
  { pattern: /intelligence-platform\/transaction-graph/, routes: ['intelligence-transaction-graph'] },
  { pattern: /intelligence-platform\/incident-center/, routes: ['intelligence-incidents'] },
  { pattern: /intelligence-platform\/knowledge-registry/, routes: ['intelligence-knowledge'] },
  { pattern: /intelligence-platform\/developer-platform/, routes: ['intelligence-developers'] },
  { pattern: /intelligence-platform\/query-studio/, routes: ['intelligence-query-studio'] },
  { pattern: /intelligence-platform\/watchlists/, routes: ['intelligence-watchlists'] },
  { pattern: /intelligence-platform\/protocol-explorer/, routes: ['intelligence-protocols'] },

  // Backend / routes modifications
  { pattern: /backend\/src\/api\/bitcoin/, routes: ['tx', 'address', 'blocks'] },
  { pattern: /backend\/src\/api\/universe/, routes: ['dogecoin', 'zcash', 'protocols'] },
];

/**
 * Resolves changed files into affected route IDs.
 *
 * @param {string[]} changedFiles List of relative paths from git diff
 * @returns {string[]} Deduplicated list of route IDs to capture
 */
export function resolveChangedRoutes(changedFiles = []) {
  const affected = new Set(ALWAYS_INCLUDED_ROUTES);

  // Check if intelligence platform was modified anywhere
  const intelligenceChanged = changedFiles.some((f) =>
    f.includes('intelligence-platform') || f.includes('intelligence-fixtures')
  );
  if (intelligenceChanged) {
    for (const r of INTELLIGENCE_ROUTES) {
      affected.add(r);
    }
  }

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');
    for (const mapping of COMPONENT_ROUTE_MAP) {
      if (mapping.pattern.test(normalized)) {
        for (const routeId of mapping.routes) {
          affected.add(routeId);
        }
      }
    }
  }

  return Array.from(affected);
}
