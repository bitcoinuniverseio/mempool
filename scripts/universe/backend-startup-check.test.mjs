import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { databaseReady, readCapabilities } from './backend-startup-check.mjs';

test('HTTP capability must confirm a configured reachable database behind registered routes', async () => {
  const document = { schemaVersion: 'universe-explorer-capabilities-v1', features: {
    mining: { enabled: true, routesRegistered: true, dependencies: [{ name: 'database', configured: true, reachable: true }] },
  } };
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/v1/capabilities');
    response.end(JSON.stringify(document));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(databaseReady(await readCapabilities({ host: '127.0.0.1', port: server.address().port })), true);
    document.features.mining.dependencies[0].reachable = false;
    assert.equal(databaseReady(await readCapabilities({ host: '127.0.0.1', port: server.address().port })), false);
    document.features.mining.dependencies[0].reachable = true;
    document.features.mining.routesRegistered = false;
    assert.equal(databaseReady(await readCapabilities({ host: '127.0.0.1', port: server.address().port })), false);
    assert.equal(databaseReady({}), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('a listener that never answers cannot pass backend readiness', async () => {
  const server = createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(readCapabilities({ host: '127.0.0.1', port: server.address().port }, 50), /deadline/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
