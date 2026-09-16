# BIP157/158 owned filter reads and local matching

The block-filter, range and checkpoint endpoints now use an operator-configured Bitcoin Core basic block filter index. Set UNIVERSE_FILTER_RPC_ORIGIN and UNIVERSE_FILTER_RPC_COOKIE_FILE (or RPC USER/PASSWORD) in the backend runtime only. The node must already have blockfilterindex=1 and be synchronized. getblockfilter returns both filter and header; there is no getblockfilterheader RPC.

GET blocks/:hash-or-height accepts network=main,test,testnet4,signet,regtest. GET ranges accepts the same network plus inclusive start/end, at most32 blocks (default latest16). GET checkpoints returns the latest up to five positive multiples of1000, not a complete cfcheckpt P2P response. Before height1000 an established source legitimately returns no positive checkpoint. Two requests maximum,15seconds overall,3seconds per RPC,2.1MB response and4MB encoded interval bounds.

Reads bind expected network/genesis, synchronized basic index, exact80-byte block-header hash, active-chain height, previous-block link and stable tip before/after retrieval. The codec checks canonical CompactSize, bounded Golomb-Rice decoding, mapped-value range and zero byte padding. SHA256d filter hashes and headers are checked using correct internal hash byte order. The preceding filter header remains trusted owned-node evidence. This does not reconstruct every served filter from its full block/prevouts, sync a proof-of-work header chain, or establish independent peer agreement.

The Filter Explorer rechecks hash, element count and header linkage in the browser. The Local Scanner sends only public height/network selectors and matches scripts locally with SipHash2-4 and BIP158 mapping. It accepts addresses, addr(address), raw(scriptHex), or explicitly labeled offline public filter interval JSON. Other descriptors, xpub expansion, full-block confirmation and complete wallet history remain unsupported. Candidate matches are not confirmed transactions; false positives remain unconfirmed. Edited input, cancellation and destruction clear stale results. Offline input has no established chain provenance.

The Header Verifier retains the cross-peer operation and adds an explicit owned-index linkage operation. Provider overview, directory/history and multi-peer verification still report the missing P2P prober. Tor/decoy/split-peer controls are retained but disabled and marked unavailable, not represented as active protection.

Tests reconstruct every official BIP158 testnet vector's mapped values from raw blocks and supplied prevout scripts, independently compare expected filter headers, and reject malformed encoding/hash/link changes. Browser codec is byte-identical to backend codec and tested separately. Runtime success against an owned indexed Core is not established: new task node launch was rejected by automatic approval review with generic reason blocked by policy; existing owned Core19483 and Signet38335 expose txindex only. No existing node was restarted/reconfigured.

Primary references: https://bitcoincore.org/en/doc/29.0.0/rpc/blockchain/getblockfilter/ ; https://github.com/bitcoin/bips/blob/master/bip-0157.mediawiki ; https://github.com/bitcoin/bips/blob/master/bip-0158.mediawiki .

## Preserved operation catalog

UI routes remain /network/light-client, /providers, /provider/:providerId, /filters, /verify, /scan and /privacy under that prefix. The overview and provider pages require P2P observations. The filter page reads the owned index; verifier exposes both owned linkage and unavailable independent peer comparison. The scanner performs bounded local matching and does not use a background worker or persist verified headers to IndexedDB in this implementation.

The API prefix is /api/v1/intelligence/compact-filters. Existing GET overview, providers, providers/:providerId, providers/:providerId/history and verifications/:verificationId, plus POST verifications, remain unavailable until the owned P2P prober is connected. Existing GET blocks/:blockHash, checkpoints and ranges now use the bounded owned reader described above. No original operation was removed or silently reclassified as peer agreement.
