# Arkade native codec

This isolated Node tool pins `@arkade-os/sdk` to **0.4.72** in package-lock.json.
Install within this directory using `npm ci --ignore-scripts --no-audit --no-fund`.
Do not install through the candidate backend/frontend node_modules junctions.
Run `node --test codec.test.mjs`. Ship codec.mjs, package.json, package-lock.json,
and installed production dependencies together. Backend defaults to this location;
UNIVERSE_ARKADE_CODEC can select an absolute packaged codec.mjs path. Node executes
it in a bounded child (5-second timeout, bounded input/output, concurrency limit).

Input is the native public package `{nodes,leaf_outpoint,default_vtxo}`. Nodes
contain native SDK PSBT trees; default_vtxo supplies x-only pubkey, server_pubkey,
and exit_delay_blocks. The pinned SDK validates TxTree structure and compiles the
DefaultVtxo output policy. The wrapper binds declared IDs, selected leaf and policy,
rejects cycles/unknown extensions, and preserves all original PSBTs. It does not
sign or broadcast. Unsupported custom policies reject instead of being approximated.

Arkade-to-MVV adds a summary and preserves this entire package; reverse conversion
revalidates and requires exact summary agreement. Expiry is null when the supplied
native proof does not establish it. This envelope is not a complete wallet backup.
Bark-to-Arkade and reverse do not rewrite signed transactions: Bark fixtures use
nSequence=0, while the pinned Arkade tree validator requires 0xffffffff. Conversion
requires a protocol-supported transaction/signature migration, which is not supplied.

Four native codec tests and three actual local HTTP checks cover PSBT preservation,
round trip, altered policy, cycle rejection, and incompatible sequence rejection.
The generated unsigned Arkade fixture is not a live provider/settlement proof.
Owned chain reads, independent script execution when context is known, maturity,
funding, final sweep and relay acceptance remain distinct evidence.


## Disposable exit execution proof

exit-regtest-proof.mjs builds genuine signed native TxTree branches, official DefaultVtxo CSV sweeps, funded P2A children, and executes the pinned SDK keyless UnilateralExit.Executor on a separate disposable Core29 Regtest node at localhost19486. It checks chain=regtest before broadcasts and never accepts an arbitrary endpoint. It expects the existing isolated workspace ark-exit-regtest-proof/regtest/.cookie; the cookie is read only and never logged. Wallet keys from the test are ephemeral and not saved. Signed public fixtures and confirmed recovery evidence are saved in that workspace directory. Existing completed cases are reused.

Run only with the explicitly created disposable Regtest node: node rust/arkade-codec/exit-regtest-proof.mjs from the candidate root. No npm install is necessary after the locked codec install. This is a protocol-specific local test tool, not a user-wallet broadcaster. The branch signatures use genuine two-party tapscript authorization; it does not reproduce an Arkade coordinator batch/MuSig ceremony. Core29 accepts P2A, while the current independent btcd standard-policy verifier rejects this witness version; preserve this distinction in evidence.
