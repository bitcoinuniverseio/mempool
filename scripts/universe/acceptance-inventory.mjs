import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(resolve(root, 'frontend/package.json'));
const ts = require('typescript');
const ledgerPath = resolve(root, 'docs/acceptance/2026-09-05-inventory.json');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8').replace(/^\uFEFF/, ''));
const app = resolve(root, 'frontend/src/app');
const sources = [
  ['master-page.module.ts', ''], ['app-routing.module.ts', ''],
  ['universe/universe-routing.module.ts', 'protocols'],
  ['universe/portfolio/portfolio.routes.ts', 'portfolio'],
  ['universe/anima/anima.routes.ts', 'anima'],
  ['universe/multichain-explorer/multichain-explorer.module.ts', 'dogecoin'],
  ['universe/multichain-explorer/multichain-explorer.module.ts', 'zcash'],
  ['components/transaction/transaction.module.ts', 'tx'],
  ['components/block/block.module.ts', 'block'],
  ['lightning/lightning.routing.module.ts', 'lightning'],
  ['docs/docs.routing.module.ts', 'docs'], ['docs/docs.routing.module.ts', 'api'],
  ['bitcoin-graphs.module.ts', ''],
  ['universe/chain-graphs/chain-graphs.module.ts', 'dogecoin/graphs'],
  ['universe/chain-graphs/chain-graphs.module.ts', 'zcash/graphs'],
  ['universe/chain-docs/chain-docs.module.ts', 'dogecoin/docs'],
  ['universe/chain-docs/chain-docs.module.ts', 'zcash/docs'],
];
const normalize = (...parts) => '/' + parts.join('/').split('/').filter(Boolean).join('/');
const parse = file => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const prop = (node, name) => node.properties.find(p => p.name?.getText() === name)?.initializer;
const text = node => node && (ts.isStringLiteralLike(node) ? node.text : undefined);
const sourcePath = (specifier, file) => {
  let path = specifier.startsWith('@app/') ? resolve(app, specifier.slice(5))
    : specifier.startsWith('@components/') ? resolve(app, 'components', specifier.slice(12))
    : resolve(dirname(file), specifier);
  if (!path.endsWith('.ts')) { path += '.ts'; }
  return path;
};
const routes = [];
const unresolved = [];
for (const [name, prefix] of sources) {
  const file = resolve(app, name);
  if (!existsSync(file)) { unresolved.push({ file: name, reason: 'Named module path must be resolved' }); continue; }
  const source = parse(file);
  const imports = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) { continue; }
    for (const binding of statement.importClause?.namedBindings?.elements || []) {
      imports.set(binding.name.text, sourcePath(statement.moduleSpecifier.text, file));
    }
  }
  function visit(node, parent = prefix) {
    if (ts.isObjectLiteralExpression(node) && prop(node, 'path')) {
      const localPath = text(prop(node, 'path'));
      if (localPath === undefined) { return; }
      const path = normalize(parent, localPath);
      const component = prop(node, 'component')?.getText();
      const lazy = prop(node, 'loadComponent')?.getText() || '';
      const lazyImport = lazy.match(/import\(['"]([^'"]+)['"]\)/)?.[1];
      const lazyClass = lazy.match(/\.then\([^=]+=>\s*\w+\.(\w+)/)?.[1];
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      routes.push({ path, source: relative(root, file).replaceAll('\\', '/'), line,
        component: component || lazyClass || null,
        componentFile: component ? imports.get(component) : lazyImport ? sourcePath(lazyImport, file) : null,
        redirectTo: text(prop(node, 'redirectTo')) ?? null,
        lazyChildren: prop(node, 'loadChildren')?.getText() || null });
      const children = prop(node, 'children');
      if (children) { ts.forEachChild(children, child => visit(child, path)); }
      return;
    }
    ts.forEachChild(node, child => visit(child, parent));
  }
  visit(source);
}

const components = new Map();
for (const route of routes) {
  if (!route.componentFile || components.has(route.componentFile) || !existsSync(route.componentFile)) { continue; }
  const source = parse(route.componentFile);
  const templates = [];
  const calls = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name?.getText() === 'template' && ts.isStringLiteralLike(node.initializer)) {
      templates.push(node.initializer.text);
    }
    if (ts.isPropertyAssignment(node) && node.name?.getText() === 'templateUrl') {
      const template = text(node.initializer);
      if (template) { templates.push(readFileSync(resolve(dirname(route.componentFile), template), 'utf8')); }
    }
    if (ts.isCallExpression(node) && /^this\.\w+\.\w+/.test(node.expression.getText())) {
      calls.push({ expression: node.expression.getText(), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const controls = templates.flatMap(template => [...template.matchAll(/<(button|input|select|textarea|form|a)\b[^>]*>/g)]
    .map(match => ({ element: match[1], markup: match[0] })));
  const handlers = templates.flatMap(template => [...template.matchAll(/\(([\w.]+)\)\s*=\s*"([^"]+)"/g)]
    .map(match => ({ event: match[1], expression: match[2] })));
  components.set(route.componentFile, { source: relative(root, route.componentFile).replaceAll('\\', '/'),
    component: route.component, controls, handlers, calls, status: 'NOT TESTED' });
}
for (const row of ledger.navigation) {
  row.declarations = routes.filter(route => route.path === row.path).map(({ componentFile, ...route }) => route);
  row.componentInventory = [...new Set(routes.filter(route => route.path === row.path && route.componentFile)
    .map(route => relative(root, route.componentFile).replaceAll('\\', '/')))];
}
const inventory = { schemaVersion: 1, scope: 'Q02/Q08 named routes and directly declared components only',
  method: 'TypeScript AST declarations and source controls; not router or operation acceptance',
  generatedAt: new Date().toISOString(), unresolved, additionalDeclaredPaths: routes.filter(route =>
    !ledger.navigation.some(row => row.path === route.path)).map(({ componentFile, ...route }) => route),
  components: [...components.values()] };
const operationId = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
inventory.operations = inventory.components.flatMap(component => {
  const entryPoints = [...new Set(routes.filter(route => route.componentFile &&
    relative(root, route.componentFile).replaceAll('\\', '/') === component.source).map(route => route.path))];
  const uniqueHandlers = [...new Map(component.handlers.map(handler => [JSON.stringify(handler), handler])).values()];
  return uniqueHandlers.map(handler => ({ id: 'UI-' + operationId(component.source + JSON.stringify(handler)),
    source: component.source, entryPoints, ...handler, status: 'NOT TESTED', role: 'unverified', network: 'unverified',
    authority: 'unverified', dependencies: component.calls, steps: [], evidence: [],
    remainingPrerequisite: 'Execute actual handler and verify its dependent operation in the candidate application' }));
});
const entryFile = resolve(root, 'backend/src/index.ts');
const entrySource = parse(entryFile);
const entryText = entrySource.getFullText();
const apiOperations = [];
for (const statement of entrySource.statements) {
  if (!ts.isImportDeclaration(statement) || !statement.importClause?.name) { continue; }
  const name = statement.importClause.name.text;
  if (!entryText.includes(name + '.initRoutes(')) { continue; }
  const file = sourcePath(statement.moduleSpecifier.text, entryFile);
  if (!existsSync(file)) { continue; }
  const source = parse(file);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      /^(get|post|put|patch|delete|options|head|use)$/.test(node.expression.name.text) && node.arguments.length) {
      const argument = node.arguments[0];
      if (ts.isStringLiteralLike(argument) || ts.isTemplateExpression(argument) || ts.isBinaryExpression(argument)) {
        const pathExpression = argument.getText();
        const method = node.expression.name.text.toUpperCase();
        const sourceName = relative(root, file).replaceAll('\\', '/');
        apiOperations.push({ id: 'API-' + operationId(sourceName + method + pathExpression), method, pathExpression,
          source: sourceName, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          registration: name + '.initRoutes(this.app)', handlers: node.arguments.slice(1).map(arg => arg.getText()),
          status: 'NOT TESTED', role: 'unverified', network: 'unverified', dependencies: [], steps: [], evidence: [],
          remainingPrerequisite: 'Resolve configured registration, method variants, authorization and actual dependency readback' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
inventory.apiOperations = apiOperations;
inventory.operationDenominatorReconciled = false;
inventory.limitations = ['Source event bindings are operation candidates, not runtime passes.',
  'Conditional registration, service branches, query variants, streams and authorization still require execution.',
  'Overlay operations are recorded separately by the contract owner.'];
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
writeFileSync(resolve(root, 'docs/acceptance/2026-09-05-controls.json'), JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ navigation: ledger.navigation.length, matched: ledger.navigation.filter(row => row.declarations.length).length,
  components: components.size, controls: inventory.components.reduce((n, component) => n + component.controls.length, 0),
  handlers: inventory.components.reduce((n, component) => n + component.handlers.length, 0),
  uiOperationCandidates: inventory.operations.length, registeredApiCandidates: apiOperations.length, unresolved }));
