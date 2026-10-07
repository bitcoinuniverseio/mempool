# Owned public offer reads

`GET lightning/offers?limit=20` accepts `limit` from 1 to 50 and a returned opaque `cursor`. Responses preserve `offers` and `total`, and add `nextCursor` and independently observed source provenance. A changed catalog, publication intent, source, or expired cursor requires restarting pagination (409). Reads are uncached and bounded to two concurrent operations and 15 seconds. Native socket calls have a five-second timeout; each page independently observes the source.

Configure both `UNIVERSE_BOLT12_RPC_SOCKET` and `UNIVERSE_BOLT12_PUBLICATION_FILE` as absolute operator paths on the Linux node deployment. The Unix socket must belong to the backend UID, allow no world access, and have no executable permission bits. RPC is restricted to `getinfo`, `getchaininfo`, `getrawblockbyheight`, and `listoffers`; browser inputs cannot choose a socket, file, RPC method or source. The native pinned offer decoder must also be installed at its existing fixed repository path.

The publication file is at most 64 KiB and contains:

```json
{
  "schema": "universe-bolt12-publication-v1",
  "revision": "operator-controlled-publication-revision",
  "network": "signet",
  "genesisHash": "the-selected-network-genesis",
  "signetChallenge": "the-actual-configured-signet-challenge",
  "nodeId": "the-observed-compressed-node-public-key",
  "implementationVersion": "v26.06.8",
  "updatedAt": "2026-10-04T00:00:00Z",
  "publishedOfferIds": ["an-intentionally-public-CLN-offer-id"]
}
```

Replace the descriptive values with independently measured deployment values. Only explicitly published IDs are returned; internal labels and unpublished offers are excluded. A missing or malformed source is 503; an explicitly empty publication produces an empty result only after actual source verification. Publication edits invalidate existing cursors. Offer activation, use and expiry are re-observed on every page. Bitcoin and Lightning readiness, selected genesis, common canonical headers and Signet challenge are checked against the configured Bitcoin reader. Initial synchronization and conflicting sources fail closed.

Core Lightning v26.06.8 `common/bolt12.c:calc_offer` uses SHA256 of the offer TLV ranges as its catalog key. LDK 0.2.6 uses a different identifier. `offerId` retains the CLN key; `decoderOfferId` retains the independently decoded LDK identity. The adapter checks the native decoded TLV bytes against the CLN key rather than treating those identifiers as aliases.

Amounts and expiry are exact decimal strings (`amountMsat`, `currencyAmountAtomic`, `expiryAtomic`). `syntaxValid` records successful parsing. `validity` distinguishes disabled, used, expired, wrong-chain and unsupported-required-feature offers from `usable-unverified`. `valid` describes invoice-request eligibility at observation; `invoiceAvailability` is always `unverified`, and `paymentVerified` is always false. No invoice or payment execution is performed by this reader. The source describes one intentionally public owned catalog, without claiming a global directory.

The committed public fixtures were created on an isolated, unfunded, offline owned CLN v26.06.8 Signet node. They cover active, expired and revoked records and demonstrate the actual CLN/LDK identifier difference. Controlled reader tests additionally exercise publication filtering, exact amounts, pagination, wrong sources, cancellation and bounded capacity. Fixtures alone do not establish a live deployment's acceptance.
