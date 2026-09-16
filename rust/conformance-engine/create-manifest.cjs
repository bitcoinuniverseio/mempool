/* Operator-only source checkout utility. Does not start nodes or configure a live backend. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..'),backend=path.join(root,'backend');
if(process.argv.length!==4)throw Error('Usage: node create-manifest.cjs <absolute-bitcoind> <new-output-directory>');
const core=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]);
fs.mkdirSync(output,{recursive:false,mode:0o700});
process.env.TS_NODE_PROJECT=path.join(backend,'tsconfig.json');require(path.join(backend,'node_modules/ts-node/register/transpile-only'));
const req=require('module').createRequire(path.join(backend,'package.json')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),pin=p=>({path:p,sha256:hash(p)});
const token=crypto.randomBytes(32).toString('hex'),key=path.join(output,'authentication.key');
fs.writeFileSync(key,crypto.randomBytes(32),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(output,'execution-token.txt'),token,{flag:'wx',mode:0o600});
const suffix=process.platform==='win32'?'.exe':'';
const manifest={schema:'conformance-engines-v1',artifact_directory:path.join(output,'artifacts'),authentication_key_file:key,core:pin(core),rust:pin(path.join(__dirname,'target/release/universe-conformance-engine'+suffix)),btcd:pin(path.join(root,'rust/script-trace/script-trace'+suffix)),node:pin(process.execPath),bitcoinjs_transaction_sha256:hash(req.resolve('bitcoinjs-lib/src/transaction')),bitcoinjs_block_sha256:hash(req.resolve('bitcoinjs-lib/src/block')),varuint_sha256:hash(req.resolve('varuint-bitcoin')),javascript_tree_sha256:require(path.join(backend,'src/api/intelligence/consensus-conformance/conformance-pins')).javascriptTreeDigest(),execution_token_sha256:crypto.createHash('sha256').update(token).digest('hex')};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
console.log('Created pinned manifest and separate authentication files. Restrict filesystem ACLs before enabling a runner. No process was started.');
