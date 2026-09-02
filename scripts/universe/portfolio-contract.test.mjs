import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HELD_SCHEMAS,
  PORTFOLIO_SCHEMA_VERSION,
  compare,
  interfaceProperties,
  schemaProperties,
  validateDocument,
} from './portfolio-contract.mjs';

/** A document shaped like the real one, small enough to reason about. */
function document(overrides = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'Universe Portfolio API', version: PORTFOLIO_SCHEMA_VERSION },
    paths: { '/networks': { get: {} } },
    components: {
      schemas: {
        Holding: {
          type: 'object',
          properties: { assetKey: {}, quantityAtomic: {} },
        },
      },
    },
    ...overrides,
  };
}

test('a well formed document raises nothing', () => {
  assert.deepEqual(validateDocument(document()), []);
});

test('a document naming another version is refused', () => {
  const problems = validateDocument(
    document({ info: { version: 'universe-portfolio-v0' } }),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /universe-portfolio-v0/);
});

test('a document with no paths or schemas is refused', () => {
  const problems = validateDocument({
    openapi: '3.1.0',
    info: { version: PORTFOLIO_SCHEMA_VERSION },
  });
  assert.ok(problems.some((problem) => problem.includes('component schemas')));
  assert.ok(problems.some((problem) => problem.includes('paths')));
});

test('interface properties are read at one level, ignoring nesting and comments', () => {
  const source = [
    'export interface Thing {',
    '  /** A comment naming somethingElse: which is not a field. */',
    '  readonly first: string;',
    '  readonly second?: {',
    '    readonly buried: string;',
    '  };',
    '  readonly third: readonly string[];',
    '}',
    '',
  ].join('\n');
  const names = interfaceProperties(source, 'Thing');
  assert.deepEqual([...names].sort(), ['first', 'second', 'third']);
});

test('a missing interface is reported rather than passing silently', () => {
  assert.equal(interfaceProperties('export interface Other {\n}\n', 'Thing'), null);
});

test('schema properties come back, and an unknown schema is null', () => {
  assert.deepEqual([...schemaProperties(document(), 'Holding')].sort(), [
    'assetKey',
    'quantityAtomic',
  ]);
  assert.equal(schemaProperties(document(), 'Nothing'), null);
});

test('a field the contract defines and the interface lacks is caught', () => {
  const types = [
    'export interface PortfolioHolding {',
    '  readonly assetKey: string;',
    '}',
    '',
  ].join('\n');
  const held = [{ schema: 'Holding', interface: 'PortfolioHolding', mayOmit: [] }];
  const problems = compareWith(held, document(), types);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /cannot read Holding\.quantityAtomic/);
});

test('a field the interface has and the contract does not is caught', () => {
  const types = [
    'export interface PortfolioHolding {',
    '  readonly assetKey: string;',
    '  readonly quantityAtomic: string;',
    '  readonly invented: string;',
    '}',
    '',
  ].join('\n');
  const held = [{ schema: 'Holding', interface: 'PortfolioHolding', mayOmit: [] }];
  const problems = compareWith(held, document(), types);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /invented is not defined by Holding/);
});

test('an omission that was written down is allowed', () => {
  const types = [
    'export interface PortfolioHolding {',
    '  readonly assetKey: string;',
    '}',
    '',
  ].join('\n');
  const held = [
    { schema: 'Holding', interface: 'PortfolioHolding', mayOmit: ['quantityAtomic'] },
  ];
  assert.deepEqual(compareWith(held, document(), types), []);
});

test('every held schema names both a schema and an interface', () => {
  for (const held of HELD_SCHEMAS) {
    assert.ok(held.schema, 'a held entry names no schema');
    assert.ok(held.interface, `${held.schema} names no interface`);
    assert.ok(Array.isArray(held.mayOmit), `${held.schema} has no omission list`);
  }
});

/**
 * `compare` reads the module level HELD_SCHEMAS, so these cases drive the
 * same logic through an explicit table by temporarily standing in for it.
 */
function compareWith(held, doc, types) {
  const original = HELD_SCHEMAS.splice(0, HELD_SCHEMAS.length, ...held);
  try {
    return compare(doc, types);
  } finally {
    HELD_SCHEMAS.splice(0, HELD_SCHEMAS.length, ...original);
  }
}
