import { fixtures, addressFixtures, detailFixtures, stateOverrides } from './fixtures.mjs';
import { chainFixtures, chainStateOverrides } from './chain-fixtures.mjs';
import { assetFixtures } from './asset-fixtures.mjs';
import { intelligenceFixtures } from './intelligence-fixtures.mjs';

/**
 * Fixture Schema Version.
 */
export const FIXTURE_SCHEMA_VERSION = 'universe-fixture-v1';

/**
 * Static nondynamic resources that are intentionally not mocked and load
 * directly from the local built frontend.
 */
export const ALLOWED_STATIC_ASSET_REGEX = /\.(js|mjs|css|woff2?|ttf|png|jpe?g|svg|webp|avif|ico|json|map|webmanifest)$/i;

/**
 * Normalizes an API path for matching.
 */
export function normalizeApiPath(pathname) {
  return '/' + pathname.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * Summarizes request body safely for diagnostics without leaking credentials.
 */
export function safeBodySummary(rawBody) {
  if (!rawBody) return null;
  if (typeof rawBody === 'string') {
    try {
      const parsed = JSON.parse(rawBody);
      return typeof parsed === 'object' && parsed !== null
        ? Object.keys(parsed).slice(0, 10)
        : String(rawBody).slice(0, 100);
    } catch {
      return String(rawBody).slice(0, 100);
    }
  }
  return null;
}

/**
 * Comprehensive Method-Aware Fixture Router.
 */
export class FixtureRouter {
  constructor(options = {}) {
    this.schemaVersion = FIXTURE_SCHEMA_VERSION;
    this.recordedFailures = [];
    this.unmatchedRequests = [];
    this.thirdPartyRequests = [];
    this.currentRouteId = options.routeId ?? 'unknown';
    this.currentScenarioId = options.scenarioId ?? 'default';
    this.currentState = options.state ?? 'populated';
    this.currentNetwork = options.network ?? 'bitcoin';
    this.registry = [];
    this.loadAllFixtures();
  }

  setContext(routeId, scenarioId, state = 'populated', network = 'bitcoin') {
    this.currentRouteId = routeId;
    this.currentScenarioId = scenarioId;
    this.currentState = state;
    this.currentNetwork = network;
  }

  register(entry) {
    this.registry.push({
      method: (entry.method || 'GET').toUpperCase(),
      path: normalizeApiPath(entry.path),
      query: entry.query ?? null,
      bodyMatcher: entry.bodyMatcher ?? null,
      state: entry.state ?? null,
      network: entry.network ?? null,
      status: entry.status ?? 200,
      contentType: entry.contentType ?? 'application/json',
      response: entry.response,
    });
  }

  loadAllFixtures() {
    // 1. Core fixtures
    for (const [path, data] of Object.entries(fixtures)) {
      if (typeof path === 'string' && path.startsWith('/')) {
        this.register({ method: 'GET', path, response: data });
      }
    }

    // 2. Address and detail fixtures
    for (const [path, data] of Object.entries(addressFixtures)) {
      this.register({ method: 'GET', path, response: data });
    }
    for (const [path, data] of Object.entries(detailFixtures)) {
      this.register({ method: 'GET', path, response: data });
    }

    // 3. Chain fixtures
    for (const [path, data] of Object.entries(chainFixtures)) {
      this.register({ method: 'GET', path, response: data });
    }

    // 4. Asset fixtures
    for (const [path, data] of Object.entries(assetFixtures)) {
      this.register({ method: 'GET', path, response: data });
    }

    // 5. Intelligence fixtures
    for (const [key, data] of Object.entries(intelligenceFixtures)) {
      const parts = key.split(' ');
      const method = parts.length > 1 ? parts[0] : 'GET';
      const path = parts.length > 1 ? parts[1] : parts[0];
      this.register({ method, path, response: data });
    }

    // 6. Batch endpoints
    this.register({
      method: 'POST',
      path: '/api/v1/universe/transactions/batch',
      response: { results: [] },
    });
    this.register({
      method: 'POST',
      path: '/api/v1/universe/outpoints/batch',
      response: { results: [] },
    });
  }

  match(requestDetails) {
    const method = requestDetails.method.toUpperCase();
    const normalizedPath = normalizeApiPath(requestDetails.pathname);
    const query = requestDetails.query ?? {};
    const body = requestDetails.body ?? null;
    const state = this.currentState;
    const network = this.currentNetwork;

    // Check state overrides first
    const overrides = { ...stateOverrides, ...chainStateOverrides };
    for (const [pattern, rule] of Object.entries(overrides)) {
      if (pattern === '**' || normalizedPath.includes(pattern) || new RegExp(pattern).test(normalizedPath)) {
        if (rule.states && rule.states[state]) {
          const overrideRule = rule.states[state];
          if (overrideRule.hang) {
            return { action: 'hang' };
          }
          if (overrideRule.status && overrideRule.status >= 400) {
            return {
              action: 'fulfill',
              status: overrideRule.status,
              contentType: 'application/json',
              response: overrideRule.response ?? { error: 'Injected state error' },
            };
          }
          if (overrideRule.response !== undefined) {
            return {
              action: 'fulfill',
              status: 200,
              contentType: 'application/json',
              response: overrideRule.response,
            };
          }
        }
      }
    }

    // Find in registry matching method and path
    const candidate = this.registry.find((entry) => {
      if (entry.method !== method) return false;
      if (entry.path !== normalizedPath) {
        // Support prefix match only for specific dynamic prefixes like /api/v1/intelligence/forecasts/
        if (!normalizedPath.startsWith(entry.path)) return false;
      }
      if (entry.network && entry.network !== network) return false;
      if (entry.state && entry.state !== state) return false;

      // Query matcher
      if (entry.query) {
        for (const [k, v] of Object.entries(entry.query)) {
          if (query[k] !== String(v)) return false;
        }
      }

      // Body matcher
      if (entry.bodyMatcher) {
        if (typeof entry.bodyMatcher === 'function') {
          if (!entry.bodyMatcher(body)) return false;
        } else if (typeof entry.bodyMatcher === 'object') {
          for (const [bk, bv] of Object.entries(entry.bodyMatcher)) {
            if (body?.[bk] !== bv) return false;
          }
        }
      }

      return true;
    });

    if (candidate) {
      return {
        action: 'fulfill',
        status: candidate.status,
        contentType: candidate.contentType,
        response: candidate.response,
      };
    }

    return null;
  }

  handle(requestDetails) {
    const matchResult = this.match(requestDetails);
    if (matchResult) {
      return matchResult;
    }

    // Fail closed: record failure
    const failureRecord = {
      method: requestDetails.method,
      path: requestDetails.pathname,
      query: requestDetails.query,
      bodySummary: safeBodySummary(requestDetails.body),
      routeId: this.currentRouteId,
      scenarioId: this.currentScenarioId,
      state: this.currentState,
      network: this.currentNetwork,
      timestampUtc: new Date().toISOString(),
    };

    this.unmatchedRequests.push(failureRecord);
    this.recordedFailures.push(`Unmatched ${requestDetails.method} request to ${requestDetails.pathname}`);

    return {
      action: 'fail',
      status: 500,
      contentType: 'application/json',
      response: {
        error: `Fixture missing for ${requestDetails.method} ${requestDetails.pathname}`,
        code: 'FIXTURE_MISSING',
        details: failureRecord,
      },
    };
  }
}
