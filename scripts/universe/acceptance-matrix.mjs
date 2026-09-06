// Source-only acceptance expansion. Never starts services or applies a source-derived PASS.
// node scripts/universe/acceptance-matrix.mjs [--check] [--evidence path.json]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(resolve(root, 'frontend/package.json'));
const ts = require('typescript');
const output = 'docs/acceptance/operation-matrix-2026-09-06.json';
const inventories = ['docs/acceptance/2026-09-05-inventory.json', 'docs/acceptance/2026-09-05-controls.json'];
const protocolFile = 'docs/protocols/PROTOCOL-COVERAGE.json';
const healthHandoffFile = 'docs/acceptance/explorer-health-handoff-2026-09-06.json';
const universeApiFile = 'frontend/src/app/universe/universe-api.service.ts';
const catalogFile = 'backend/src/api/admin-adapter/admin-adapter.catalog.ts';
const adminFile = 'backend/src/api/admin-adapter/admin-adapter.routes.ts';
const kindsFile = 'backend/node_modules/@bitcoinuniverse/ecosystem-contracts/lib/admin-control.js';
const portfolioFile = 'frontend/src/app/universe/portfolio/data/portfolio-v2-api.service.ts';
const bundleNames = ['known_coverage.json', 'source_ledger.json', 'audit_report.md', 'protocol_inventory.md', 'anima-dispatch-evidence.json', 'gateway-anima-regression.test.mjs'];
const hash = value => createHash('sha256').update(value).digest('hex');
const cleanPath = value => value.replaceAll('\\', '/');

export function uniqueIds(rows, label) {
  assert(Array.isArray(rows), `${label} must be an array`);
  const ids = rows.map(row => row.id);
  assert(ids.every(id => typeof id === 'string' && id.length > 0), `${label} contains an absent ID`);
  assert.equal(new Set(ids).size, ids.length, `${label} contains duplicate IDs`);
  return ids;
}

export function tableIds(cell) {
  let expanded = cell.replace(/\b([A-Z0-9-]+-)(\d+)\s+(?:to|through)\s+\1(\d+)\b/g, (match, prefix, first, last) => {
    if (+last < +first || +last - +first > 1000) throw new Error(`Invalid ID range: ${match}`);
    return Array.from({ length: +last - +first + 1 }, (_, i) => prefix + String(+first + i).padStart(first.length, '0')).join(', ');
  });
  expanded = expanded.replace(/\b([A-Z0-9-]+-)(\d+)((?:,\s*\d+)+)/g,
    (_match, prefix, first, rest) => [first, ...rest.split(',').slice(1).map(s => s.trim())].map(n => prefix + n).join(', '));
  return [...new Set(expanded.match(/\b(?:[A-Z][A-Z0-9]*-)+[A-Z0-9]+(?:-[A-Z0-9]+)*\b|\b[QPA]\d+\b/g) || [])];
}

export function buildMatrix({ evidencePath } = {}) {
  const artifacts = new Map(), records = new Map(), parsed = new Map();
  const gaps = [], sourceGroups = {};
  function read(path) {
    path = cleanPath(path);
    if (!artifacts.has(path)) {
      const bytes = readFileSync(resolve(root, path));
      artifacts.set(path, { path, sha256: hash(bytes), bytes: bytes.length, text: bytes.toString('utf8').replace(/^\uFEFF/, '') });
    }
    return artifacts.get(path);
  }
  function ref(path, extra = {}) { return { artifact: cleanPath(path), sha256: read(path).sha256, ...extra }; }
  const json = path => JSON.parse(read(path).text);
  function source(path) {
    if (!parsed.has(path)) parsed.set(path, ts.createSourceFile(path, read(path).text, ts.ScriptTarget.Latest, true));
    return parsed.get(path);
  }
  function add(id, kind, definition = {}, sourceRef) {
    assert(!records.has(id), `Generated duplicate ID: ${id}`);
    const row = { id, kind, status: 'NOT TESTED', acceptanceScope: null, role: 'unresolved', network: 'unverified',
      requiredServices: [], fixtureIdentity: null, assertions: [], actual: null, evidence: [], blockers: [],
      links: [], sources: sourceRef ? [sourceRef] : [], ...definition };
    records.set(id, row); return row;
  }
  function link(row, targetId, reason) {
    assert(records.has(targetId), `${row.id} references missing ${targetId}`);
    if (targetId !== row.id && !row.links.some(link => link.id === targetId && link.reason === reason)) row.links.push({ id: targetId, reason });
  }
  function parseExpression(path, expression) {
    const parsedExpression = ts.createSourceFile('expression.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
    return evaluate(parsedExpression.statements[0]?.expression, path, new Set());
  }
  function declaration(path, name) {
    const matches = [];
    function visit(node) {
      if (ts.isVariableDeclaration(node) && node.name.getText() === name && node.initializer) matches.push(node.initializer);
      ts.forEachChild(node, visit);
    }
    visit(source(path));
    if (matches.length === 0 || matches.some(node => node.getText() !== matches[0].getText())) return undefined;
    return matches[0];
  }
  function evaluate(node, path, seen) {
    if (!node) return undefined;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (node.getText() === 'config.MEMPOOL.API_URL_PREFIX') {
      const values = [];
      function visit(current) {
        if (ts.isPropertyAssignment(current) && (current.name.text || current.name.getText()) === 'API_URL_PREFIX' && ts.isStringLiteralLike(current.initializer)) values.push(current.initializer.text);
        ts.forEachChild(current, visit);
      }
      visit(source('backend/src/config.ts'));
      return values.length && new Set(values).size === 1 ? values[0] : undefined;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return evaluate(node.expression, path, seen);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return undefined;
      return evaluate(declaration(path, node.text), path, new Set([...seen, node.text]));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = evaluate(node.left, path, seen), right = evaluate(node.right, path, seen);
      return typeof left === 'string' && typeof right === 'string' ? left + right : undefined;
    }
    if (ts.isTemplateExpression(node)) {
      let value = node.head.text;
      for (const span of node.templateSpans) {
        const part = evaluate(span.expression, path, seen); if (typeof part !== 'string') return undefined;
        value += part + span.literal.text;
      }
      return value;
    }
    return undefined;
  }
  function literalArray(path, name) {
    let node = declaration(path, name);
    while (node && (ts.isAsExpression(node) || ts.isCallExpression(node))) node = ts.isAsExpression(node) ? node.expression : node.arguments[0];
    assert(node && ts.isArrayLiteralExpression(node), `Cannot resolve ${path}:${name}`);
    const values = node.elements.map(element => evaluate(element, path, new Set()));
    assert(values.every(value => typeof value === 'string'), `Non-literal ${path}:${name}`);
    return values;
  }
  function conditions(node) {
    const result = [];
    for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
      if (ts.isIfStatement(parent)) result.push({ expression: parent.expression.getText(), branch: child === parent.elseStatement ? 'else' : 'then' });
    }
    return result;
  }
  function matchingCalls(path, predicate) {
    const matches = [];
    function visit(node) { if (ts.isCallExpression(node) && predicate(node)) matches.push(node); ts.forEachChild(node, visit); }
    visit(source(path)); return matches;
  }
  const [inventory, controls] = inventories.map(json), protocolManifest = json(protocolFile);
  assert.deepEqual([inventory.navigation.length, inventory.protocols.length, inventory.operations.length, controls.operations.length, controls.apiOperations.length],
    [351, 39, 37, 304, 546], 'Pinned source candidate counts changed; reconcile the source inventories explicitly');
  for (const [group, rows, file, pointer] of [
    ['navigation', inventory.navigation, inventories[0], '/navigation'],
    ['protocol-identity', inventory.protocols, inventories[0], '/protocols'],
    ['named-operation', inventory.operations, inventories[0], '/operations'],
    ['ui-candidate', controls.operations, inventories[1], '/operations'],
    ['api-candidate', controls.apiOperations, inventories[1], '/apiOperations'],
  ]) {
    sourceGroups[group] = uniqueIds(rows, group);
    rows.forEach((original, index) => {
      const row = add(original.id, group, {
        entry: original.entry || original.path || null,
        sourceFile: original.source || null,
        operation: original.operation || original.expression || null,
        method: original.method || null,
        priorAssertion: { status: original.status, scope: original.acceptanceScope || null, evidence: original.evidence || [],
          renderStatus: original.renderStatus || null, remainingPrerequisite: original.remainingPrerequisite || null },
        definition: Object.fromEntries(Object.entries(original).filter(([key]) => !['status', 'evidence', 'renderEvidence', 'baselineStatus', 'operationStatus', 'renderStatus'].includes(key))),
        remainingWork: 'Execute and reconcile the complete method, query, event, network and role variants. Historical/source assertions are not current acceptance.',
      }, ref(file, { pointer: `${pointer}/${index}` }));
      if (original.source && existsSync(resolve(root, original.source))) row.sources.push(ref(original.source));
      if (group === 'api-candidate') {
        const calls = matchingCalls(original.source, call => call.arguments[0]?.getText() === original.pathExpression && call.expression.getText().endsWith('.' + original.method.toLowerCase()));
        row.sourceCall = calls.length === 1 ? calls[0].expression.getText() : null;
        row.candidateClassification = row.sourceCall === `axios.${original.method.toLowerCase()}` ? 'outbound-http-client-call' : row.sourceCall ? 'route-registration-candidate' : 'unresolved-current-source-call';
        row.routeConditions = calls.length === 1 ? conditions(calls[0]) : [];
        row.registrationConditions = matchingCalls('backend/src/index.ts', call => call.getText() === original.registration).flatMap(conditions);
        row.route = row.candidateClassification === 'outbound-http-client-call' ? null : parseExpression(original.source, original.pathExpression) || null;
        row.routeResolution = row.route ? 'source literal/default expression; runtime mounting/configuration unverified' : 'unresolved expression; no path guessed';
        if (!row.route) gaps.push({ id: original.id, kind: row.candidateClassification === 'outbound-http-client-call' ? 'outbound-call-in-source-inventory' : 'api-route-expression', expression: original.pathExpression, sourceCall: row.sourceCall });
      }
    });
  }
  // Reconcile the inspected verification modules against the current routes.
  // Older candidate IDs remain authoritative; only newly declared routes get
  // a new stable ID. This bounded pass does not certify the whole denominator.
  sourceGroups['current-api-addition'] = [];
  for (const [module, registration] of [
    ['bootstrap', 'bootstrapRoutes'], ['multiparty', 'multipartyRoutes'],
    ['opentimestamps', 'openTimestampsRoutes'], ['private-submission', 'privateSubmissionRoutes'],
  ]) {
    const routeFile = `backend/src/api/intelligence/${module}/${module}.routes.ts`;
    const serviceFile = `backend/src/api/intelligence/${module}/${module}.service.ts`;
    const registrationCalls = matchingCalls('backend/src/index.ts', call => call.expression.getText() === `${registration}.initRoutes`);
    for (const call of matchingCalls(routeFile, call => /^app\.(get|post)$/.test(call.expression.getText()) && ts.isStringLiteralLike(call.arguments[0]))) {
      const method = call.expression.name.text.toUpperCase(), route = call.arguments[0].text;
      const matchingRows = [...records.values()].filter(row => row.sourceFile === routeFile && row.method === method && row.route === route);
      assert(matchingRows.length <= 1, `Duplicate inspected route binding ${method} ${route}`);
      let row = matchingRows[0];
      if (!row) {
        const id = `API-CURRENT-${hash(`${routeFile}|${method}|${route}`).slice(0, 12)}`;
        row = add(id, 'current-api-addition', { sourceFile: routeFile, method, route,
          remainingWork: 'Execute the newly inventoried route against its owned source and actual consumer; source discovery is not acceptance.' }, ref(routeFile));
        sourceGroups['current-api-addition'].push(id);
      }
      row.role = 'public request at this route; no handler authorization guard';
      if (route.includes('/operator/')) row.requiredRoleForExecution = 'Private authorized operator; require a guard before connecting the currently absent executor';
      row.routeConditions = conditions(call);
      row.registrationConditions = registrationCalls.flatMap(conditions);
      row.routeResolution = 'Current literal route and backend initialization registration inspected; external gateway policy and runtime journey remain separate';
      row.sources.push(ref(serviceFile), ref('backend/src/index.ts', { symbol: `${registration}.initRoutes` }));
    }
  }
  const healthHandoff = json(healthHandoffFile);
  assert.equal(read(healthHandoffFile).sha256, '98ed8c95130a94dd30d8d998f4f3a4f84c2b6bfe4aefa084817783600f4805b7', 'Preserve the original health handoff bytes');
  assert.equal(healthHandoff.schema, 'explorer-health-investigation-supplement-v1');
  sourceGroups['health-verification'] = uniqueIds(healthHandoff.rows.map(row => ({ id: row.coverageId })), 'health handoff');
  assert.equal(sourceGroups['health-verification'].length, 40, 'Reconcile changed health handoff identities explicitly');
  const historyBindings = {
    'R-03': ['dogecoin', 'block', '/block/:reference'],
    'R-04-TX': ['dogecoin', 'transaction', '/tx/:txid'],
    'R-04-ADDRESS': ['dogecoin', 'address', '/address/:address'],
    'R-04-UNSPENT': ['dogecoin', 'outpoint', '/outpoint/:txid/:vout'],
    'R-04-SPENT': ['dogecoin', 'outpoint', '/outpoint/:txid/:vout'],
    'R-06-BLOCK': ['zcash', 'block', '/block/:reference'],
    'R-06-TX': ['zcash', 'transaction', '/tx/:txid'],
    'R-06-ADDRESS': ['zcash', 'address', '/address/:address'],
    'R-06-OUTPOINT': ['zcash', 'outpoint', '/outpoint/:txid/:vout'],
  };
  healthHandoff.rows.forEach((original, index) => {
    const history = historyBindings[original.coverageId];
    const inventoryOnly = ['R-07', 'R-08', 'T-15', 'T-16', 'T-17'].includes(original.coverageId);
    const apiBindings = history ? [{ method: 'GET', route: `/api/v1/${history[0]}${history[2]}` }]
      : inventoryOnly ? [] : [{ method: 'GET', route: '/api/v1/chains' }, { method: 'GET', route: '/api/v1/:chain/status' }];
    const row = add(original.coverageId, 'health-verification', {
      chain: original.chain, operation: original.operation, feature: original.feature,
      role: original.coverageId === 'T-16' ? 'authorized private Control Center identity and unauthorized negative case'
        : original.coverageId === 'R-08' ? 'repository acceptance reviewer' : 'public explorer reader',
      method: apiBindings.length === 1 ? apiBindings[0].method : null,
      route: apiBindings.length === 1 ? apiBindings[0].route : null,
      apiBindings, entry: history ? `/${history[0]}${history[2].replace(':address', ':reference')}` : inventoryOnly ? null : 'Chain selector and chain status',
      query: history ? { network: 'mainnet', ...(history[1] === 'block' || history[1] === 'address'
        ? history[0] === 'dogecoin' ? { page: ':page', limit: ':bounded-limit' } : { offset: ':offset', limit: ':bounded-limit' } : {}) } : {},
      requiredServices: history ? [history[0] === 'dogecoin' ? 'owned Dogecoin Blockbook confirmed-history source' : 'index-zcash-metaprotocols'] : [],
      assertions: original.expectedAssertions, workPackage: original.workPackage,
      priorAssertion: { status: original.status, verificationKind: original.verificationKind,
        reason: original.reason, evidenceRefs: original.evidenceRefs, endToEndPass: original.endToEndPass },
      remainingWork: 'Execute the specified regression and applicable real source-to-consumer journey. The handoff is historical source evidence, not a current result.',
    }, ref(healthHandoffFile, { pointer: `/rows/${index}` }));
    if (apiBindings.length) row.sources.push(ref(universeApiFile));
    if (history) row.sources.push(ref('frontend/src/app/universe/multichain-explorer/multichain-explorer.module.ts'));
  });
  for (const path of readdirSync(resolve(root, 'docs/acceptance')).filter(name => name.endsWith('.md')).sort().map(name => `docs/acceptance/${name}`)) {
    read(path).text.split(/\r?\n/).forEach((line, index) => {
      if (!line.startsWith('|')) return;
      const cell = line.split('|')[1].trim(), ids = tableIds(cell);
      for (const id of ids) {
        const row = records.get(id) || add(id, /^(?:Q\d+-[PA]\d+|SW-UI-|OV-|NET-\d|SP-\d|SW-\d|BASE-|DOC-)/.test(id) ? 'named-operation' : 'named-source-row');
        row.sources.push(ref(path, { line: index + 1, originalIdCell: cell, originalTableRow: line }));
        row.entry ||= line.split('|')[2]?.trim() || null;
      }
    });
  }
  sourceGroups['named-markdown'] = [...records.values()].filter(row => row.sources.some(s => s.artifact.endsWith('.md'))).map(row => row.id);
  // Navigation/component links are exact strings or exact recorded component source files only.
  for (const original of controls.operations) {
    const row = records.get(original.id);
    for (const nav of inventory.navigation) {
      if (original.entryPoints?.includes(nav.path)) link(row, nav.id, 'exact recorded entry path');
      if (nav.componentInventory?.includes(original.source)) link(row, nav.id, 'exact recorded component source');
    }
  }
  const protocolIds = uniqueIds(protocolManifest.protocols, 'protocol manifest');
  assert.deepEqual([...protocolIds].sort(), inventory.protocols.map(row => row.protocol).sort(), 'Protocol identities were lost or invented');
  sourceGroups['protocol-operation'] = [];
  protocolManifest.protocols.forEach((protocol, index) => {
    const identity = inventory.protocols.find(row => row.protocol === protocol.id);
    uniqueIds(protocol.readOperationDescriptors, `${protocol.id} read descriptors`);
    assert.deepEqual(protocol.readOperationDescriptors.map(row => row.id).sort(), [...protocol.implementedReadOperations].sort(), `${protocol.id} descriptor/operation mismatch`);
    for (const [operationIndex, descriptor] of protocol.readOperationDescriptors.entries()) {
      const id = `${identity.id}/${descriptor.id}`;
      const row = add(id, 'protocol-operation', { role: 'public read', chain: protocol.chain, network: 'unverified',
        declaredNetworks: protocol.networks, declarationScope: 'Registry source declaration; not actual network support or a required mainnet spend',
        authority: protocol.indexerAuthority, method: descriptor.method, route: descriptor.route,
        operation: descriptor.id, authorityPath: descriptor.authorityPath, protocol: protocol.id,
        requiredServices: [protocol.indexerAuthority],
        assertions: ['Use a genuinely supported network and exact authoritative public/test-owned reference.', 'Verify the source-to-consumer result and relevant checkpoint or cursor.', 'Reject malformed, unavailable and mismatched evidence distinctly.'],
        remainingWork: 'Per-authority supported-network/schema/reference and source-to-consumer result are unexecuted.',
      }, ref(protocolFile, { pointer: `/protocols/${index}/readOperationDescriptors/${operationIndex}` }));
      link(row, identity.id, 'exact protocol identity'); sourceGroups['protocol-operation'].push(id);
    }
  });
  const handoffOperationIds = uniqueIds(healthHandoff.protocolOperationRows.map(row => ({ id: row.coverageId })), 'health handoff protocol operations');
  assert.equal(handoffOperationIds.length, sourceGroups['protocol-operation'].length, 'Reconcile changed handoff operation coverage');
  assert.equal(healthHandoff.protocolCatalogue.length, protocolIds.length, 'Reconcile changed handoff protocol identities');
  for (const original of healthHandoff.protocolCatalogue) {
    const identity = inventory.protocols.find(row => row.id === original.id);
    const protocol = protocolManifest.protocols.find(row => row.id === original.protocol);
    assert(identity?.protocol === original.protocol && protocol?.chain === original.chain && protocol.indexerAuthority === original.authority,
      `Handoff identity or authority mismatch: ${original.id}`);
    assert.deepEqual([...original.declaredOperations].sort(), [...protocol.implementedReadOperations].sort(), `Handoff operation mismatch: ${original.id}`);
  }
  healthHandoff.protocolOperationRows.forEach((original, index) => {
    const identity = inventory.protocols.find(row => row.protocol === original.protocol);
    const row = records.get(`${identity?.id}/${original.operation}`);
    assert(row && original.coverageId === `${identity.id}.${original.operation}` && row.chain === original.chain && row.authority === original.authority,
      `Cannot bind handoff operation without changing identity: ${original.coverageId}`);
    row.handoffBinding = { coverageId: original.coverageId, ledgerId: row.id, priorStatus: original.status,
      evidenceLevel: original.evidenceLevel, originalMissingPrerequisite: original.missingPrerequisite,
      steps: original.steps, expectedFinalOutcome: original.expectedFinalOutcome };
    row.sources.push(ref(healthHandoffFile, { pointer: `/protocolOperationRows/${index}` }));
    link(records.get('R-07'), row.id, 'exact handoff protocol operation');
    link(records.get('T-15'), row.id, 'protocol operation failure, pagination and batch variants remain separately required');
  });
  const prefix = evaluate(declaration(adminFile, 'PREFIX'), adminFile, new Set());
  assert.equal(prefix, '/internal/admin/v1', 'Review changed private admin prefix before generation');
  for (let n = 1; n <= 12; n++) {
    const row = records.get(`Q07-A${String(n).padStart(2, '0')}`);
    const entry = row?.entry?.match(/^(GET|POST) `([^`]+)`$/);
    assert(entry && entry[2].startsWith('/'), `Cannot resolve recorded private admin entry ${row?.id}`);
    row.method = entry[1]; row.route = prefix + entry[2].split('?')[0];
    row.role = 'authorized private Control Center identity';
    row.sources.push(ref(adminFile, { symbol: 'PREFIX and route registration' }));
  }
  const acceptedResourceKinds = literalArray(kindsFile, 'ADMIN_RESOURCE_KINDS');
  let resourceKinds;
  function findAdvertisedKinds(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText() === 'resourceKinds' && ts.isArrayLiteralExpression(node.initializer)) {
      assert(!resourceKinds, 'Multiple resource-kind advertisements need scoped resolution');
      resourceKinds = node.initializer.elements.map(element => evaluate(element, adminFile, new Set()));
    }
    ts.forEachChild(node, findAdvertisedKinds);
  }
  findAdvertisedKinds(source(adminFile));
  assert(resourceKinds?.every(kind => acceptedResourceKinds.includes(kind)), 'Advertised resource kinds must belong to the shared contract');
  assert.equal(resourceKinds.length, 7, 'Review changed resource-kind contract before generation');
  sourceGroups['admin-resource-variant'] = [];
  for (const kind of resourceKinds) for (const operation of ['list', 'detail']) {
    const parentId = operation === 'list' ? 'Q07-A03' : 'Q07-A04';
    const row = add(`${parentId}/${kind}`, 'admin-resource-variant', { role: 'authorized private Control Center identity',
      method: 'GET', route: `${prefix}/resources${operation === 'detail' ? `/${kind}/:id` : ''}`,
      routeTemplate: `${prefix}/resources${operation === 'detail' ? '/:kind/:id' : ''}`,
      query: operation === 'list' ? { kind, q: ':filter', limit: ':bounded-limit' } : {},
      assertions: operation === 'list' ? ['Actual scoped records, filter, limit, truncation and unavailable source.'] : ['Exact matching resource, known absence, and unavailable source.'],
      remainingWork: 'Actual authorized private-adapter read and independently checked source result.',
    }, ref(adminFile, { symbol: 'explorerManifest.resourceKinds' }));
    row.sources.push(ref(adminFile)); link(row, parentId, 'explicit resource-kind expansion'); sourceGroups['admin-resource-variant'].push(row.id);
  }
  const catalog = [];
  function visitCatalog(node) {
    if (ts.isCallExpression(node) && node.expression.getText() === 'definition' && ts.isObjectLiteralExpression(node.arguments[0])) {
      const object = node.arguments[0];
      const property = name => object.properties.find(p => p.name?.getText() === name)?.initializer;
      catalog.push({ id: evaluate(property('id'), catalogFile, new Set()), risk: evaluate(property('risk'), catalogFile, new Set()),
        requiredPermission: evaluate(property('requiredPermission'), catalogFile, new Set()),
        inputFields: property('inputFields')?.getText() || '[]', sideEffects: property('sideEffects')?.getText(),
        postconditions: property('postconditions')?.getText(), line: source(catalogFile).getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visitCatalog);
  }
  visitCatalog(source(catalogFile)); uniqueIds(catalog, 'admin operation catalog');
  assert.equal(catalog.length, 12, 'Review changed admin operation catalog before generation');
  const tasks = literalArray(catalogFile, 'ALLOWED_INDEXER_TASKS');
  sourceGroups['admin-operation-variant'] = [];
  for (const operation of catalog) for (const task of operation.id === 'explorer.indexer.task.run' ? tasks : [null]) for (const action of ['preview', 'execute']) {
    const parentId = action === 'preview' ? 'Q07-A07' : 'Q07-A08';
    const row = add(`${parentId}/${operation.id}${task ? `/${task}` : ''}`, 'admin-operation-variant', {
      operation: operation.id, action, method: 'POST', route: `${prefix}/operations/${operation.id}/${action}`,
      routeTemplate: `${prefix}/operations/:operationId/${action}`,
      role: 'authorized private Control Center identity', permission: operation.requiredPermission, risk: operation.risk,
      input: task ? { task } : {}, inputDefinition: operation.inputFields,
      sideEffects: operation.sideEffects, postconditions: operation.postconditions,
      assertions: action === 'preview' ? ['Validate operation-specific input and actual preconditions without performing execution.'] : ['Signed identity and elevation as required, allowed safe scope, idempotency/locks, actual postcondition and durable run/audit readback.'],
      remainingWork: 'Actual compatible caller/adapter and permitted controlled dependencies. High-risk and irreversible execution require explicit authorization; listing a row does not authorize it.',
    }, ref(catalogFile, { line: operation.line }));
    row.sources.push(ref(adminFile)); link(row, parentId, 'exact catalog operation and action'); sourceGroups['admin-operation-variant'].push(row.id);
  }
  const portfolioText = read(portfolioFile).text;
  for (const field of ['timestamp', 'height', 'fromTimestamp', 'fromHeight', 'toTimestamp', 'toHeight']) {
    assert(portfolioText.includes(`params.set('${field}'`), `Review changed portfolio field ${field}`);
  }
  assert(portfolioText.includes("'/api/v2/universe/portfolio'"), 'Review changed portfolio prefix');
  const portfolioBase = '/api/v2/universe/portfolio/:chain/:network/:address';
  for (const [number, method, suffix] of [
    [17, 'getNetworks$', 'networks'], [18, 'getSummary$', 'summary'], [19, 'getHoldings$', 'holdings'],
    [20, 'getActivity$', 'activity'], [21, 'getPerformance$', 'performance'], [22, 'getSnapshot$', 'snapshot'],
    [23, 'getDelta$', 'delta'], [24, 'getUtxos$', 'utxos'], [25, 'getCounterparties$', 'counterparties'], [26, 'getCoverage$', 'coverage'],
  ]) {
    let methodSource;
    function findMethod(node) { if (ts.isMethodDeclaration(node) && node.name.getText() === method) methodSource = node; ts.forEachChild(node, findMethod); }
    findMethod(source(portfolioFile));
    assert(methodSource?.getText().includes(`+ '/${suffix}'`), `Review changed portfolio method ${method}`);
    const row = records.get(`Q05-P${number}`);
    row.method = 'GET'; row.route = (number === 17 ? '/api/v2/universe/portfolio' : portfolioBase) + '/' + suffix;
    row.role = 'public address reader'; row.sources.push(ref(portfolioFile, { symbol: method }));
  }
  for (const [number, format] of [[30, 'assets-csv'], [31, 'activity-csv'], [32, 'utxos-csv'], [33, 'evidence-json']]) {
    assert(portfolioText.includes(`'${format}'`) && portfolioText.includes("'/export?format='"), `Review changed portfolio export ${format}`);
    const row = records.get(`Q05-P${number}`);
    row.method = 'GET'; row.route = `${portfolioBase}/export`; row.query = { format }; row.role = 'public address reader';
    row.sources.push(ref(portfolioFile, { symbol: 'exportUrl' }));
  }
  sourceGroups['portfolio-history-variant'] = [];
  for (const point of ['height', 'timestamp']) {
    const row = add(`Q05-P22/${point}`, 'portfolio-history-variant', { role: 'public address reader', method: 'GET', route: `${portfolioBase}/snapshot`,
      query: { [point]: ':historical-point' }, operation: 'snapshot',
      assertions: ['Resolve requested historical point against authoritative history.', 'Preserve partial coverage, exact quantities and network identity.'],
      remainingWork: 'Actual supported history and requested-point source-to-consumer result.',
    }, ref(portfolioFile, { symbol: 'getSnapshot$' }));
    link(row, 'Q05-P22', 'explicit snapshot query variant'); sourceGroups['portfolio-history-variant'].push(row.id);
  }
  for (const from of ['Height', 'Timestamp']) for (const to of ['Height', 'Timestamp']) {
    const row = add(`Q05-P23/from${from}-to${to}`, 'portfolio-history-variant', { role: 'public address reader', method: 'GET', route: `${portfolioBase}/delta`,
      query: { [`from${from}`]: ':from-point', [`to${to}`]: ':to-point' }, operation: 'delta',
      assertions: ['Check both requested historical points and ordered interval.', 'Independently reconcile exact delta components and partial coverage.'],
      remainingWork: 'Actual supported from/to history and independent source-to-consumer delta result.',
    }, ref(portfolioFile, { symbol: 'getDelta$' }));
    link(row, 'Q05-P23', 'explicit from/to point combination'); sourceGroups['portfolio-history-variant'].push(row.id);
  }
  // Link exact paths only. Parameter aliases and abbreviated markdown routes remain unresolved.
  for (const row of records.values()) {
    if (!row.route) continue;
    for (const candidate of controls.apiOperations) {
      const target = records.get(candidate.id);
      if (row.method === target.method && (row.routeTemplate || row.route) === target.route) link(row, candidate.id, 'exact method and route expression');
    }
    for (const original of inventory.operations) {
      if (original.entry === `${row.method} ${row.route}`) link(row, original.id, 'exact recorded method and entry');
    }
  }
  const searchedDirectories = [resolve(root, '../audits'), resolve(root, '../.tmp'),
    resolve(process.env.USERPROFILE || root, '.codex/attachments')].filter(existsSync);
  let bundleMatches = [];
  if (searchedDirectories.length) {
    try { bundleMatches = execFileSync('rg', ['--files', '--hidden', ...bundleNames.flatMap(name => ['-g', name]), ...searchedDirectories], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/).filter(Boolean); }
    catch (error) {
      if (error.code === 'ENOENT') {
        for (const dir of searchedDirectories) {
          try {
            const entries = readdirSync(dir, { recursive: true });
            for (const entry of entries) {
              const filename = typeof entry === 'string' ? entry : entry.name;
              if (bundleNames.some(name => cleanPath(filename).endsWith('/' + name) || cleanPath(filename) === name)) {
                bundleMatches.push(resolve(dir, filename));
              }
            }
          } catch {}
        }
      } else if (error.status !== 1) {
        throw error;
      }
    }
  }
  const missingBundleNames = bundleNames.filter(name => !bundleMatches.some(path => cleanPath(path).endsWith('/' + name)));
  gaps.push({ id: 'G-COVERAGE-01', kind: 'missing-handoff-bundle', missing: missingBundleNames, found: bundleMatches.map(cleanPath), searchedDirectories: searchedDirectories.map(cleanPath),
    reason: 'The described 243-row working ledger cannot be imported without its original IDs and files. No IDs or contents are reconstructed.' });
  gaps.push({ id: 'G-COVERAGE-01', kind: 'unreconciled-semantics',
    reason: 'Conditional mounting, generic dispatch selectors, unresolved route expressions, query/event/role variants and exact UI-to-API dependencies remain to reconcile. Source sets overlap and are not an operation denominator.' });
  gaps.push({ id: 'Q07-A03', kind: 'shared-versus-advertised-resource-kind', advertised: resourceKinds,
    acceptedButNotAdvertised: acceptedResourceKinds.filter(kind => !resourceKinds.includes(kind)),
    reason: 'Resource routes validate the broader shared contract; only seven kinds are advertised by Explorer. Retain unknown/unadvertised-kind behavior for acceptance without inventing additional products.' });
  // Preserve all source controls/handler records, including those without an operation candidate ID.
  const sourceCandidates = { additionalDeclaredPaths: controls.additionalDeclaredPaths,
    components: controls.components.map(component => ({ ...component, currentSource: ref(component.source) })),
    unresolved: controls.unresolved, limitations: controls.limitations };
  if (evidencePath) {
    const overlay = json(evidencePath);
    assert.equal(overlay.schemaVersion, 'universe-operation-evidence-v1');
    uniqueIds(overlay.rows, 'current evidence overlay');
    for (const item of overlay.rows) {
      const row = records.get(item.id); assert(row, `Evidence references unknown ID ${item.id}`);
      assert(['PASS LOCAL', 'PASS SIGNET', 'PASS NETWORK', 'FAIL', 'BLOCKED', 'NOT TESTED', 'NOT APPLICABLE'].includes(item.status), `Unknown current status ${item.status}`);
      assert(typeof item.scope === 'string' && item.scope.length, `${item.id} needs an explicit acceptance scope`);
      assert(Array.isArray(item.evidence), `${item.id} needs evidence references`);
      if (item.status.startsWith('PASS') || item.status === 'FAIL' || item.status === 'NOT APPLICABLE') assert(item.evidence.length, `${item.id} status requires concrete evidence`);
      if (item.status === 'BLOCKED') assert(item.blockers?.length, `${item.id} must name established prerequisites`);
      if (['PASS SIGNET', 'PASS NETWORK'].includes(item.status)) {
        assert(typeof item.journeyId === 'string' && item.journeyId.length && item.fixtureIdentity && item.actual, `${item.id} needs a distinct real journey identity, reference and actual result`);
        assert(item.network && item.network !== 'unverified' && (item.status !== 'PASS SIGNET' || item.network === 'signet'), `${item.id} needs the actually verified network`);
      }
      const evidence = item.evidence.map(entry => {
        assert(typeof entry.artifact === 'string' && entry.artifact.length, `${item.id} needs an evidence artifact path`);
        const actualHash = read(entry.artifact).sha256;
        if (entry.sha256) assert.equal(entry.sha256, actualHash, `${item.id} evidence artifact changed`);
        return { ...entry, artifact: cleanPath(entry.artifact), sha256: actualHash };
      });
      Object.assign(row, { status: item.status, acceptanceScope: item.scope, evidence, blockers: item.blockers || [], actual: item.actual || null,
        network: item.network || row.network, fixtureIdentity: item.fixtureIdentity || null, journeyId: item.journeyId || null,
        candidateRevisions: item.candidateRevisions || null, verificationTime: item.verificationTime || null,
        repairState: item.repairState || null, verificationKind: item.verificationKind || null,
        previousExecutionAssertions: item.previousExecutionAssertions || [] });
      row.sources.push(ref(evidencePath, { rowId: item.id }));
    }
  }
  read('scripts/universe/acceptance-matrix.mjs');
  const rows = [...records.values()];
  const matrix = { schemaVersion: 'universe-operation-matrix-v1', sourceBaseline: 'b8d5e3bdc837681c7ce2b8cb91616262f432a313',
    status: 'FUNCTIONAL NO-GO', operationDenominatorReconciled: false, operationDenominator: null,
    countingPolicy: 'Groups and rows overlap. No source-count sum or rendering percentage is application coverage.',
    healthHandoff: { artifact: healthHandoffFile, sha256: read(healthHandoffFile).sha256,
      healthRows: sourceGroups['health-verification'].length, protocolOperationBindings: handoffOperationIds.length,
      protocolOperationIds: handoffOperationIds,
      historicalCounts: { FAIL: 8, BLOCKED: 14, 'NOT TESTED': 18 },
      countingPolicy: 'Health scenarios supplement the preserved ledger; period-form protocol IDs bind to existing slash-form IDs without adding operations.' },
    realNetworkE2ePasses: new Set(rows.filter(row => ['PASS SIGNET', 'PASS NETWORK'].includes(row.status)).map(row => row.journeyId)).size,
    sourceCounts: { navigation: inventory.navigation.length, namedOperations: inventory.operations.length, protocolIdentities: inventory.protocols.length,
      uiCandidates: controls.operations.length, apiCandidates: controls.apiOperations.length, additionalRouteDeclarations: controls.additionalDeclaredPaths.length,
      components: controls.components.length, controls: controls.components.reduce((n, c) => n + c.controls.length, 0), handlerBindings: controls.components.reduce((n, c) => n + c.handlers.length, 0) },
    sourceGroups, sources: [...artifacts.values()].map(({ text, ...entry }) => entry).sort((a, b) => a.path.localeCompare(b.path)),
    sourceCandidates, gaps, rows };
  validateMatrix(matrix);
  return matrix;
}

export function validateMatrix(matrix) {
  const ids = new Set(uniqueIds(matrix.rows, 'matrix'));
  for (const [name, group] of Object.entries(matrix.sourceGroups)) {
    assert.equal(new Set(group).size, group.length, `${name} contains duplicate import identities`);
    for (const id of group) assert(ids.has(id), `${name} lost ${id}`);
  }
  assert.equal(matrix.operationDenominatorReconciled, false, 'This generator cannot assert completed semantic reconciliation');
  assert.equal(matrix.operationDenominator, null, 'Do not substitute source counts for an operation denominator');
  const sources = new Map(matrix.sources.map(source => [source.path, source]));
  for (const row of matrix.rows) {
    for (const link of row.links) assert(ids.has(link.id), `${row.id} has a dangling link: ${link.id}`);
    for (const ref of row.sources) assert.equal(ref.sha256, sources.get(ref.artifact)?.sha256, `${row.id} has invalid source hash lineage`);
    for (const ref of row.evidence) assert.equal(ref.sha256, sources.get(ref.artifact)?.sha256, `${row.id} has invalid evidence hash lineage`);
    if (row.status.startsWith('PASS')) assert(row.acceptanceScope && row.evidence.length, `${row.id} inherited unsupported acceptance`);
  }
  for (const component of matrix.sourceCandidates.components) {
    assert.equal(component.currentSource.sha256, sources.get(component.source)?.sha256, `${component.source} has invalid component source hash lineage`);
  }
  if (matrix.healthHandoff) {
    assert.equal(matrix.healthHandoff.sha256, sources.get(matrix.healthHandoff.artifact)?.sha256, 'Invalid health handoff source hash lineage');
    const bindings = matrix.rows.filter(row => row.handoffBinding);
    const bindingIds = uniqueIds(bindings.map(row => ({ id: row.handoffBinding.coverageId })), 'handoff operation bindings');
    assert.deepEqual(bindingIds.sort(), [...matrix.healthHandoff.protocolOperationIds].sort(), 'Lost handoff operation binding');
    for (const row of bindings) assert.equal(row.handoffBinding.ledgerId, row.id, 'Handoff binding changed the original ledger ID');
  }
  return true;
}

export function buildCommandMatrix(args = []) {
  const evidenceIndex = args.indexOf('--evidence');
  assert(args.every((arg, i) => arg === '--check' || arg === '--evidence' || i === evidenceIndex + 1 && evidenceIndex >= 0), 'Usage: acceptance-matrix.mjs [--check] [--evidence path.json]');
  if (evidenceIndex >= 0) assert(args[evidenceIndex + 1] && !args[evidenceIndex + 1].startsWith('--'), '--evidence requires a file path');
  // Regenerating the committed ledger must retain reviewed execution evidence.
  // Source-only exploration remains available through buildMatrix(), without
  // silently resetting reviewed rows when an operator omits an optional flag.
  return buildMatrix({ evidencePath: evidenceIndex >= 0 ? args[evidenceIndex + 1] : 'docs/acceptance/current-execution-evidence.json' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const matrix = buildCommandMatrix(args);
  if (args.includes('--check')) {
    const stored = JSON.parse(readFileSync(resolve(root, output), 'utf8'));
    validateMatrix(stored);
    const changedSources = matrix.sources.filter(source => stored.sources.find(previous => previous.path === source.path)?.sha256 !== source.sha256).map(source => source.path);
    assert.equal(hash(JSON.stringify(stored)), hash(JSON.stringify(matrix)), `Generated matrix is stale; regenerate from current source/evidence. Changed sources: ${changedSources.join(', ')}`);
  } else writeFileSync(resolve(root, output), JSON.stringify(matrix, null, 2) + '\n');
  console.log(JSON.stringify({ artifact: output, sourceCounts: matrix.sourceCounts,
    expandedGroups: Object.fromEntries(Object.entries(matrix.sourceGroups).map(([name, ids]) => [name, ids.length])),
    operationDenominatorReconciled: false, realNetworkE2ePasses: matrix.realNetworkE2ePasses, unresolved: matrix.gaps.length }, null, 2));
}
