# Network and protocol contract acceptance, 2026-09-05

Scope: WP01 / D03 / NET-01-02 / OV-01-13 and WP07 / D10 / PRO-01-39 / DOC-01. Integration owner owns the single localhost application and final UI/runtime evidence. No worker server or browser was started.

## Baseline and provenance

- mempool baseline: 4e9701186b7b6bc55aa8f02079dd92fa5facddad, develop, clean at parent preflight.
- backend-apis baseline: 7fb94a66469c7ecc863ac14915950d854b35cba4, develop, clean at parent preflight.
- Node 24.19.0; warmed dependencies reused. No package install, runner, CI, deployment, process restart, live default change, transaction signing or broadcast.
- Final source and artifact revisions are recorded below after local commits.

## Implemented and locally verified

- One validated query contract: chain and network together; intentional omission retains Bitcoin mainnet. Source selection, checkpoint/freshness caches, transaction caches and Atomicals/outpoint/ANIMA readers include both fields. A source declaring a different checkpoint network cannot be relabeled.
- Frontend asset/flow/holdings/outpoint/source and ANIMA requests carry selected context, cancel pending prior-network HTTP work, reject mismatched checkpoints and preserve batch completion. Registry cache refetches on a network switch.
- Inscription follow-up and saved paths retain Signet. Shared new visit/bookmark writes use selected network; historical storage is only restored from its recorded/path identity and conflicting entries are excluded without deleting stored records.
- Registry 1.1.0 retains all 39 identities, with alias resolution and operation descriptors. Historical release declarations remain unchanged; implementation, authority availability and acceptance remain separate. A directory-only identity is explicitly distinct from an implemented authority read.
- OP inscriptions objects support was missing despite an existing owned endpoint. Added projection of its validated data/offset/limit/total schema into the existing objects page. No feed or mint semantics were invented.
- Network cache changes concern in-memory readers only; existing durable event/portfolio keys already include network. No DB migration or guessed backfill is needed for these edits.

## Local evidence

| Test ID | Scope | Evidence and assertion | Result |
| --- | --- | --- | --- |
| NET-LOCAL-01 | Context boundary | New backend contracts/explorer-context.spec.ts: valid Signet, rejected partial/unknown/array/wrong-chain pairs | PASS LOCAL FIXTURE |
| NET-LOCAL-02 | Authority/cache separation | Same block reference and same txid across mainnet/Signet configured fixtures; missing/wrong network never fetches fallback source | PASS LOCAL FIXTURE |
| NET-LOCAL-03 | Checkpoint boundary | Source client rejects declared mainnet checkpoint for Signet, selects only correct network partition | PASS LOCAL FIXTURE |
| NET-LOCAL-04 | Browser consumer contract | New frontend universe-network-context.spec.ts: pending cancellation, stale result ignored, wrong checkpoint rejection, forkJoin completion, saved-link reload | PASS LOCAL FIXTURE |
| NET-LOCAL-05 | Source/dependent regressions | Backend assets/outpoints/transactions/sources/feed/objects/registry/controller/ANIMA suites, lint, typecheck and build | PASS LOCAL; final counts below |
| PRO-LOCAL-01 | All 39 protocol identities | New explorer-read-operations.spec.ts has a separate parameterized assertion per identity; aliases and truthful implementation/availability semantics | PASS LOCAL CONTRACT |
| PRO-LOCAL-02 | OP inscriptions | Valid pagination and preserved atomic strings; bad cursor/wrong offset rejected against owned schema fixture | PASS LOCAL FIXTURE |
| PRO-LIVE-01 | Older owned public deployment | 39 read-only page probes, limit=1, four bounded concurrent requests; every result HTTP404. JSON artifact includes route/time/revision. | OBSERVED OLD DEPLOYMENT FAILURE; NOT NEW-CODE E2E |

Backend suite paths are relative to backend-apis/src/universe-explorer. Frontend test paths are relative to mempool/frontend/src/app/universe. New test files are explicitly identified above. No fixture is a real Signet acceptance pass.

## Required runtime rows

| IDs | Operation | Current acceptance | Exact prerequisite |
| --- | --- | --- | --- |
| NET-01, NET-02 | Selected network through authority, follow-up, reload | BLOCKED | Approved Signet ord/mempool sources plus known Signet asset reference and actual local consumer readback |
| OV-01 | Registry / aliases / operation descriptors | BLOCKED E2E | Integration runtime serving new registry1.1.0 pin; source/local contract validation passes |
| OV-02, OV-03 | Status / source checkpoints | BLOCKED E2E | Correctly scoped owned source config and real checkpoint readback in changed overlay |
| OV-04 to OV-07 | Inscription / rune / sat / block inscriptions | BLOCKED | Owned Signet ord with necessary enabled indexes and reference fixture |
| OV-08 to OV-10 | Transaction / batch / holdings | BLOCKED | Owned Signet mempool backend plus scoped enrichers, persisted chain/indexer reference and bounded account fixture |
| OV-11, OV-12 | Outpoint / batch | BLOCKED | Owned Signet outpoint source and known reference |
| OV-13 | Per-protocol feed | BLOCKED | Each protocol's own source/route/schema and real result, independently; one parameterization cannot cover another |
| DOC-01 | Dispatch / manifest contract | PASS LOCAL CONTRACT | Root owns gateway boundary tests; documentation names v2 overlay and privacy-before-Zcash exception |
| Q05-SHARE | Encrypted portfolio share read/create/revoke | PASS LOCAL HANDLER; BLOCKED MYSQL E2E | The missing owner flow and backend handler are now implemented with an additive migration; see [portfolio sharing evidence](portfolio-sharing-2026-09-05.md). Feature defaults disabled. Approved disposable MySQL access, migration execution, restart/readback and real owner/recipient browser acceptance remain required. |

No Signet service or approved read fixture was found by integration-owner preflight. Parent observed the owned public overlay at source SHA 64f2c2259fd3097d5bdeaaf201269ba12c910849, registry1.0.0 with38 identities. That deployment is older than both the local baseline and repairs. Its HTTP404 probes cannot establish that a new adapter is broken or working. See network-contract-live-probes-2026-09-05.json.

## Protocol operation rows

These are registry identity rows, not the full application denominator. Each row's implementation operations are source-contract descriptors; BLOCKED below refers only to this run's actual authority-to-consumer acceptance, not a replacement implementation status. ANIMA's transitions/events alias, detail, items, item detail and history remain six independently required read checks despite its historical BLOCKED declaration.

| ID | Protocol | Chain | Owned authority | Implemented reads | Runtime acceptance | Remaining prerequisite |
| --- | --- | --- | --- | --- | --- | --- |
| PRO-01 | ordinals | bitcoin | ord | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, inscription, block-inscriptions | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-02 | rare_sats | bitcoin | ord | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, sat | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-03 | names | bitcoin | index-names | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-04 | bitmap | bitcoin | index-bitmap | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-05 | unat | bitcoin | index-unat | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-06 | runes | bitcoin | ord | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings, rune | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-07 | alkanes | bitcoin | index-alkanes | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-08 | mezcal | bitcoin | index-mezcal | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-09 | stamps | bitcoin | index-stamps | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-10 | src20 | bitcoin | index-stamps | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-11 | src101 | bitcoin | index-stamps | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-12 | atomicals_nft | bitcoin | index-atomicals-nfts-and-realms | registry, activity, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-13 | realms | bitcoin | index-atomicals-nfts-and-realms | registry, activity, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-14 | subrealms | bitcoin | index-atomicals-nfts-and-realms | registry, outpoint, outpoints-batch, transaction-flow, transactions-batch, address-holdings | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-15 | arc20 | bitcoin | index-atomicals | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-16 | op_return | bitcoin | index-op20 | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-17 | op_names | bitcoin | index-op20 | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-18 | op_inscriptions | bitcoin | index-opinscriptions | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-19 | op_drop | bitcoin | index-drops-and-opdrop | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-20 | drops | bitcoin | index-drops-and-opdrop | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-21 | brc20 | bitcoin | index-brc20 | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-22 | tap | bitcoin | index-tap | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-23 | dmt | bitcoin | index-dmt | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-24 | dust20 | bitcoin | index-dust20 | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-25 | block20 | bitcoin | index-block20 | registry, activity | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-26 | chainbloom | bitcoin | index-chainbloom | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-27 | patina | bitcoin | index-patina | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-28 | witness_circles | bitcoin | index-witness-circles | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-29 | tandem | bitcoin | index-tandem | registry, objects | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-30 | cat20 | fractal | index-cat20 | registry, activity | BLOCKED | Approved owned fractal:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-31 | ordex | bitcoin | index-ordinals | registry | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-32 | anima | bitcoin | index-anima | registry, status, transitions, transition, items, item, item-history | BLOCKED | Approved owned bitcoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-33 | doginals | dogecoin | ord-dogecoin | registry, chain-list, chain-detail | BLOCKED | Approved owned dogecoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-34 | drc20 | dogecoin | ord-dogecoin | registry, chain-list, chain-detail, holders | BLOCKED | Approved owned dogecoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-35 | tap_doge | dogecoin | index-doge-tap | registry, activity | BLOCKED | Approved owned dogecoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-36 | dunes | dogecoin | ord-dogecoin | registry, chain-list, chain-detail | BLOCKED | Approved owned dogecoin:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-37 | zerdinals | zcash | index-zcash-metaprotocols | registry, chain-list, chain-detail | BLOCKED | Approved owned zcash:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-38 | zrunes | zcash | index-zcash-metaprotocols | registry, chain-list, chain-detail | BLOCKED | Approved owned zcash:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |
| PRO-39 | zrc20 | zcash | index-zcash-metaprotocols | registry, chain-list, chain-detail | BLOCKED | Approved owned zcash:mainnet read fixture and changed-runtime wiring; old public deployment returns 404 for the probed page. |

The registry's mainnet declarations were not expanded to manufacture Signet acceptance. A validated request context does not by itself declare protocol/network support. Separate Dogecoin, Zcash, Fractal, Liquid and Lightning paths receive no inherited Bitcoin pass.

## Integration restriction

Local commits are permitted. The integration owner found push/PR workflow triggers on develop in both affected repositories; pushing or opening/merging a PR would start prohibited CI/runners and may deploy. Remote integration is BLOCKED by the user's no-CI/no-runner/no-deployment boundary. No bypass or workflow policy change was made.

## Final revisions and verification

Backend source repair is committed at `04ff6efd3ea2dd841742ecf48932f0b10a8b5dd0`; its generated contract is committed at `bf559073182a1f5c40ac921eae0e22006af9faf5`. The backend working tree is clean. The mempool pin names the source commit and matches the backend artifact field for field: 39 identities, registry 1.1.0. Mempool changes remain on the pinned baseline plus the permitted working tree until the integration owner's final local commit.

Follow-up scoped verification at 2026-09-05 23:01 UTC reproduced and repaired three remaining context defects: six nested evidence containers bypassed network checks; a newly subscribed directory replayed the old network's registry while the selected network was pending; and other-chain bookmark lookup used Bitcoin's selected network instead of the bookmark chain's default. Eight new assertions first failed, then passed after the repair.

Protocol detail now requests feed, objects and source state using the registry's chain. Bitcoin retains the selected network; existing other-chain directory paths retain their own mainnet reads. Pending page subscriptions are cancelled on protocol change and destruction, and pagination requests complete after one response. This prevents old pages from being appended to another protocol's results.

- `NET-LOCAL-06`: extended new `universe-network-context.spec.ts`, 51 tests including 39 individually named protocol-context cases. Request construction and fixtures only; no authority acceptance inherited.
- `NET-LOCAL-07`: new `protocol-detail/protocol-detail.component.spec.ts`, one test proving pending activity/object disposal, rejection of late pages, and teardown on destruction.
- Frontend focused regression command: 4 files, 80 tests passed (network context, API service, local storage and protocol detail).
- Backend scoped regression command: 26 suites, 452 tests passed across context, assets, outpoints, transactions, sources, activity, objects, registry, ANIMA and controller.
- Backend and frontend TypeScript checks passed. Backend manifest export `--check` passed at the clean current revision.
- Protocol gate: 25 tests passed; offline `--check` and `--against` the local backend artifact passed. These commands validate the local source contract, not the public deployment.
- Touched frontend lint: zero errors; existing unrelated service/type warnings remain. The integration owner records final build and single-tab localhost evidence separately.

The required runtime rows above remain blocked pending their named authorities and fixtures. No real Signet acceptance pass, deployment, CI run or runner use was added by these checks.
