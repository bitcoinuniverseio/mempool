import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALWAYS_INCLUDED_ROUTES,
  INTELLIGENCE_ROUTES,
  resolveChangedRoutes,
} from './impact-map.mjs';

test('empty diff returns all baseline routes', () => {
  const routes = resolveChangedRoutes([]);
  for (const required of ALWAYS_INCLUDED_ROUTES) {
    assert.ok(routes.includes(required), `Missing required baseline route ${required}`);
  }
});

test('changes to intelligence-platform include all 14 intelligence routes', () => {
  const routes = resolveChangedRoutes([
    'frontend/src/app/universe/intelligence-platform/policy-lab.component.ts',
  ]);
  for (const r of INTELLIGENCE_ROUTES) {
    assert.ok(routes.includes(r), `Missing intelligence route ${r}`);
  }
});

test('changes to state.service include chain and transaction routes', () => {
  const routes = resolveChangedRoutes([
    'frontend/src/app/services/state.service.ts',
  ]);
  assert.ok(routes.includes('address'));
  assert.ok(routes.includes('tx'));
  assert.ok(routes.includes('dogecoin'));
  assert.ok(routes.includes('zcash'));
});

test('changes to block page include block routes', () => {
  const routes = resolveChangedRoutes([
    'frontend/src/app/pages/block/block.component.ts',
  ]);
  assert.ok(routes.includes('block'));
  assert.ok(routes.includes('blocks'));
  assert.ok(routes.includes('mempool-block'));
});
