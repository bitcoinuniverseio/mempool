import { javascriptTreeDigest } from './conformance-pins';
import { readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { digest, ConformanceEvidenceError } from './conformance-evidence';
export interface EnginePin {
  path: string;
  sha256: string;
}
export interface ConformanceManifest {
  schema: 'conformance-engines-v1';
  artifact_directory: string;
  authentication_key_file: string;
  core: EnginePin;
  rust: EnginePin;
  btcd: EnginePin;
  node: EnginePin;
  bitcoinjs_transaction_sha256: string;
  bitcoinjs_block_sha256: string;
  varuint_sha256: string;
  javascript_tree_sha256: string;
  execution_token_sha256: string;
}
export function readManifest(path: string): ConformanceManifest {
  if (statSync(path).size > 16384)
    throw new ConformanceEvidenceError('invalid-engine-manifest', 'Engine manifest exceeds the supported bound.');
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (
    m.schema !== 'conformance-engines-v1' ||
    typeof m.artifact_directory !== 'string' ||
    typeof m.authentication_key_file !== 'string'
  )
    throw new ConformanceEvidenceError('invalid-engine-manifest', 'Invalid operator engine manifest.');
  for (const key of ['core', 'rust', 'btcd', 'node'])
    if (
      !m[key] ||
      typeof m[key].path !== 'string' ||
      typeof m[key].sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(m[key].sha256)
    )
      throw new ConformanceEvidenceError(
        'invalid-engine-manifest',
        'Every engine requires a pinned executable SHA256.'
      );
  for (const key of [
    'bitcoinjs_transaction_sha256',
    'bitcoinjs_block_sha256',
    'varuint_sha256',
    'javascript_tree_sha256',
    'execution_token_sha256',
  ])
    if (typeof m[key] !== 'string' || !/^[a-f0-9]{64}$/.test(m[key]))
      throw new ConformanceEvidenceError('invalid-engine-manifest', 'JavaScript parser sources require SHA256 pins.');
  m.artifact_directory = resolve(m.artifact_directory);
  m.authentication_key_file = resolve(m.authentication_key_file);
  return m;
}
export function verifyEnginePins(m: ConformanceManifest) {
  for (const engine of [m.core, m.rust, m.btcd, m.node]) {
    if (statSync(engine.path).size > 256 * 1024 * 1024 || digest(readFileSync(engine.path)) !== engine.sha256)
      throw new ConformanceEvidenceError(
        'engine-pin-mismatch',
        'A configured engine executable does not match its pinned digest.'
      );
  }
  if (resolve(m.node.path) !== resolve(process.execPath))
    throw new ConformanceEvidenceError(
      'engine-pin-mismatch',
      'The configured JavaScript engine must match this running Node executable.'
    );
  if (javascriptTreeDigest() !== m.javascript_tree_sha256)
    throw new ConformanceEvidenceError(
      'engine-pin-mismatch',
      'JavaScript transitive dependency bytes differ from the operator pin.'
    );
  const entries: [string, string][] = [
    [require.resolve('bitcoinjs-lib/src/transaction'), m.bitcoinjs_transaction_sha256],
    [require.resolve('bitcoinjs-lib/src/block'), m.bitcoinjs_block_sha256],
    [require.resolve('varuint-bitcoin'), m.varuint_sha256],
  ];
  if (
    entries.some(([path, hash]) => digest(readFileSync(path)) !== hash) ||
    require('bitcoinjs-lib/package.json').version !== '6.1.7'
  )
    throw new ConformanceEvidenceError(
      'engine-pin-mismatch',
      'The JavaScript parser implementation does not match its pinned sources.'
    );
  return [
    {
      implementation_id: 'bitcoin-core',
      name: 'Bitcoin Core',
      language: 'C++',
      version: '29.0',
      source_commit: null,
      build_hash: m.core.sha256,
      supported_targets: ['transaction_parse', 'script_verify'],
      is_reference_implementation: true,
      health_status: 'configured',
    },
    {
      implementation_id: 'rust-bitcoin',
      name: 'rust-bitcoin',
      language: 'Rust',
      version: '0.32.102',
      source_commit: null,
      build_hash: m.rust.sha256,
      supported_targets: ['transaction_parse', 'block_parse', 'compact_size'],
      is_reference_implementation: false,
      health_status: 'configured',
    },
    {
      implementation_id: 'bitcoinjs',
      name: 'bitcoinjs-lib / varuint-bitcoin',
      language: 'JavaScript',
      version: '6.1.7',
      source_commit: null,
      build_hash: digest(JSON.stringify(entries.map(([, h]) => h))),
      runtime_build_hash: m.node.sha256,
      dependency_tree_sha256: m.javascript_tree_sha256,
      supported_targets: ['transaction_parse', 'block_parse', 'compact_size'],
      is_reference_implementation: false,
      health_status: 'configured',
    },
    {
      implementation_id: 'btcd',
      name: 'btcd txscript',
      language: 'Go',
      version: '1c55c7c18179',
      source_commit: '1c55c7c18179',
      build_hash: m.btcd.sha256,
      supported_targets: ['script_verify'],
      is_reference_implementation: false,
      health_status: 'configured',
    },
  ];
}
