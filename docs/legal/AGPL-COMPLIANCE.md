# AGPL compliance

The upstream Mempool Open Source Project is licensed under the GNU Affero
General Public License v3.0 (see `LICENSE` at the repository root). This fork
preserves and honors those obligations. Status: IN PROGRESS - obligations
tracked below; final legal review before GO.

## Obligations and how this fork satisfies them

| Obligation | Implementation |
| --- | --- |
| Preserve license text | `LICENSE` retained verbatim from upstream base v3.3.1 |
| Preserve copyright notices | Upstream copyright headers and notices untouched; Universe additions carry their own headers where required |
| Preserve third-party notices | Frontend/backend dependency licenses ship unchanged; third-party notice surface exposed on the source/about page |
| Document modifications | `UPSTREAM.md` (modified subsystems table) + git history on `develop`; every Universe change is committed on top of the pinned upstream base with full history preserved |
| AGPL section 13 (network use) | The deployed service exposes a public source/about page linking the exact corresponding source: the Universe release SHA on https://github.com/bitcoinuniverseio/mempool (public repository). The page shows Universe release SHA, upstream base SHA, license, source link, build version, and third-party notices |
| Same license for modifications | All Universe modifications in this repository are AGPL-3.0 |

## Corresponding source guarantee

Every production deployment embeds its release SHA at build time and exposes it
via the source/about page and `/api/v1/universe/status`. The repository is
public, so the exact corresponding source of any deployed version is available
by SHA. Deploy tooling must refuse to ship a build whose SHA is not pushed to
the public repository.

## Trademark separation

License compliance does not grant trademark rights; see `TRADEMARK-AUDIT.md`
for the removal of Mempool Holdings marks from the public deployment.
