# Payjoin proposal verification

The analyzer compares real PSBT transactions against explicit sender policy. It rejects removed or reordered inputs and protected outputs, changed transaction version/locktime/sequences, inconsistent previous transactions, conflicting UTXO values, negative or unknown fees, and unauthorized sender-output reductions. Matching is ordered and consumes each output once.

All original outputs are protected by default. Payment substitution requires a declared original payment output index and explicit permission. A sender fee contribution requires both a non-payment output index and a maximum amount. It cannot exceed the actual fee increase or the supported additional-input cost bound. The current contribution calculation supports P2WPKH added inputs; other types have an unknown cost bound and cannot authorize a reduction.

Sender UTXOs omitted from the proposal are recovered from the original PSBT. The finalized original and finalized receiver proposal inputs are executed with the pinned btcd verifier, including every previous output needed for transaction signature hashes. Altered signatures fail. The receiver's unsigned sender inputs are never signed by this tool.

`structural_checks_passed`, `psbt_envelope_checks_passed`, and `signatures_verified` report separate evidence. `is_valid` is false for detected violations and null while final acceptance remains unestablished. Supplied UTXO metadata is not proof of current unspentness. Final sender signatures, chain availability, full transaction policy, and final signed feerate remain outside this comparison. The synthetic sample has real signatures over public fabricated outpoints and carries no funds.

The browser clears stale results on edits and network changes, sends explicit policy to the selected network, and displays failures without the former unconditional verified heading. Differential structure does not establish independent input ownership or a quantified privacy gain.

Directory probes and the narrated playground remain separate capabilities. Directory protocol negotiation, a real sender/receiver session, signing/broadcast, and full end-to-end Payjoin acceptance remain open.

Reference: [BIP78 sender checklist and fee policy](https://github.com/bitcoin/bips/blob/master/bip-0078.mediawiki#senders-payjoin-proposal-checklist).
