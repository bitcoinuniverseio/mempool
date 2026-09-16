# Swap evidence boundaries

The owned Bitcoin reader requires the selected chain, pinned genesis, explicit `initialblockdownload=false`, nonnegative integral height, and unchanged height/hash checkpoints. A confirmed transaction must have matching block identity, active-chain membership and consistent confirmations. An inconsistent source cannot establish maturity.

The browser independently decodes unsigned refund PSBTs using scure. It binds the requested outpoint, full previous transaction, witness output, destination, amount, fee, locktime, refund leaf, claim sibling, internal key, Merkle path and Taproot output. Displayed refund values must agree with those decoded amounts. This is an unsigned artifact check; it does not demonstrate a completed refund or provider settlement.

Historical observations are the latest saved check per outpoint, limited to 100 rows. Both write and read paths validate their schema; reads also verify payload hashes and reject duplicate identities. Storage integrity does not establish current chain state. The overview clears its previous network immediately and can recover after a failed read.

Controlled cryptographic fixtures, malformed-source cases and UI cancellation tests cover these boundaries. No actual Boltz lockup/refund fixture was identified in the existing isolated runtime fixtures during the September 15 forensic repair. Positive runtime swap acceptance remains open. Provider authority, offchain reconciliation, other protocol adapters and the full original operation set remain separate acceptance requirements.
