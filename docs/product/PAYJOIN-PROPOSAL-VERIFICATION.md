# Payjoin proposal verification

The analyzer compares real PSBT transactions against explicit sender policy. It rejects removed or reordered inputs and protected outputs, changed transaction version/locktime/sequences, inconsistent previous transactions, conflicting UTXO values, negative or unknown fees, and unauthorized sender-output reductions. Matching is ordered and consumes each output once.

All original outputs are protected by default. Payment substitution requires a declared original payment output index and explicit permission. A sender fee contribution requires both a non-payment output index and a maximum amount. It cannot exceed the actual fee increase or the supported additional-input cost bound. The current contribution calculation supports P2WPKH added inputs; other types have an unknown cost bound and cannot authorize a reduction.

Sender UTXOs omitted from the proposal are recovered from the original PSBT. The finalized original and finalized receiver proposal inputs are executed with the pinned btcd verifier, including every previous output needed for transaction signature hashes. Altered signatures fail. The receiver's unsigned sender inputs are never signed by this tool.

`structural_checks_passed`, `psbt_envelope_checks_passed`, and `signatures_verified` report separate evidence. Owned UTXO reads verify network genesis, exact amounts/scripts, coinbase maturity, and a stable chain tip; `chain_verified` reports their result. Reads include mempool spends and do not reserve inputs. Supplied UTXO metadata alone never establishes unspentness. The synthetic sample has real signatures over fabricated outpoints, carries no funds, and therefore fails owned UTXO checks.

An optional `final_signed_psbt` must preserve the proposal's unsigned transaction exactly. The verifier executes every final input script with the actual previous outputs, computes exact final virtual size and fee rate, enforces optional `min_feerate`, and calls the owned node's read-only `testmempoolaccept`. It checks that the chain checkpoint remains unchanged. `is_valid` can become true only when structural, envelope, original/receiver scripts, owned UTXOs, final scripts and node policy all pass. Detected violations return false; incomplete evidence remains null. Neither this endpoint nor its native checker signs or broadcasts. Positive policy evidence describes the observed node and instant, not guaranteed future propagation or confirmation.

The browser clears stale results on edits and network changes, sends explicit policy to the selected network, and displays failures without the former unconditional verified heading. Differential structure does not establish independent input ownership or a quantified privacy gain.

Directory probes and the narrated playground remain separate capabilities. Live directory negotiation, a real external sender/receiver session, browser wallet signing/broadcast, and full product Payjoin acceptance remain open. Local proof uses separate funded regtest wallets with mature outputs, real wallet signatures, actual candidate HTTP routes and owned-node policy acceptance. Altered final signatures and an unmet minimum feerate are rejected.

Reference: [BIP78 sender checklist and fee policy](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki#senders-payjoin-proposal-checklist).
