import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractRoutesFromSource,
  routeMatchesPattern,
  verifyRouteCoverageContract,
  ROUTE_EXEMPTIONS,
} from './route-contract.mjs';

test('extracts route paths and redirects accurately from Angular routing source', () => {
  const sample = `
    const routes: Routes = [
      { path: 'mining/blocks', redirectTo: 'blocks', pathMatch: 'full' },
      { path: 'tx/push', component: PushTransactionComponent },
      { path: 'tools/policy-lab', loadComponent: () => import('./policy-lab') },
      { path: 'block/:hash', loadChildren: () => import('./block.module') },
    ];
  `;

  const routes = extractRoutesFromSource(sample);
  assert.equal(routes.length, 4);
  assert.equal(routes[0].normalizedPath, '/mining/blocks');
  assert.equal(routes[0].isRedirect, true);
  assert.equal(routes[1].normalizedPath, '/tx/push');
  assert.equal(routes[1].isRedirect, false);
  assert.equal(routes[2].normalizedPath, '/tools/policy-lab');
  assert.equal(routes[3].normalizedPath, '/block/:hash');
});

test('pattern matching handles dynamic segments and root correctly', () => {
  assert.equal(routeMatchesPattern('/tx/9f4a1c7e', '/tx/:txId'), true);
  assert.equal(routeMatchesPattern('/block/000000000', '/block/:hash'), true);
  assert.equal(routeMatchesPattern('/tools/policy-lab', '/tools/policy-lab'), true);
  assert.equal(routeMatchesPattern('/dogecoin/mining', '/dogecoin/mining'), true);
  assert.equal(routeMatchesPattern('/other/path', '/tools/policy-lab'), false);
});

test('negative test: synthetic uncovered route fails the contract', () => {
  const declared = [
    { normalizedPath: '/home', isRedirect: false },
    { normalizedPath: '/uncovered-surprise-route', isRedirect: false },
  ];
  const scenarios = [
    { id: 'home', path: '/home' },
  ];

  const result = verifyRouteCoverageContract(declared, scenarios, []);
  assert.equal(result.valid, false);
  assert.ok(result.uncoveredRoutes.includes('/uncovered-surprise-route'));
  assert.ok(result.errors.some((e) => e.includes('uncovered-surprise-route')));
});

test('negative test: expired exemption fails closed', () => {
  const declared = [
    { normalizedPath: '/legacy-page', isRedirect: false },
  ];
  const scenarios = [];
  const expiredExemptions = [
    {
      pattern: '^/legacy-page$',
      reason: 'Temporary grace period',
      owner: 'qa',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
      replacementCoverage: 'tests/legacy.test.mjs',
    },
  ];

  const result = verifyRouteCoverageContract(declared, scenarios, expiredExemptions, new Date('2026-09-01T00:00:00Z'));
  assert.equal(result.valid, false);
  assert.ok(result.expiredExemptions.includes('^/legacy-page$'));
  assert.ok(result.errors.some((e) => e.includes('expired')));
});

test('negative test: orphan scenario matching no declared route fails', () => {
  const declared = [
    { normalizedPath: '/blocks', isRedirect: false },
  ];
  const scenarios = [
    { id: 'blocks', path: '/blocks' },
    { id: 'phantom-scenario', path: '/non-existent-feature-path' },
  ];

  const result = verifyRouteCoverageContract(declared, scenarios, []);
  assert.equal(result.valid, false);
  assert.ok(result.invalidScenarios.includes('phantom-scenario'));
});

test('valid scenario covering declared routes passes cleanly', () => {
  const declared = [
    { normalizedPath: '/tx/:txId', isRedirect: false },
    { normalizedPath: '/tools/policy-lab', isRedirect: false },
    { normalizedPath: '/redirect-only', isRedirect: true, redirectTo: '/tx/123' },
  ];
  const scenarios = [
    { id: 'tx', path: '/tx/9f4a1c7e5b2d8036a1f4c9e7b3d5081a2c6e4f9b7d3a1c58e26f0b4d9a7c3e15' },
    { id: 'policy-lab', path: '/tools/policy-lab' },
  ];

  const result = verifyRouteCoverageContract(declared, scenarios, ROUTE_EXEMPTIONS);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});
