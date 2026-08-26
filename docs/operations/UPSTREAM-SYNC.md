# Upstream synchronization procedure

The fork tracks `mempool/mempool` from the pinned base recorded in
`upstream-base.json`. Synchronization is scheduled, reviewable, and never
auto-merged into production.

## Remotes

- `origin`   -> https://github.com/bitcoinuniverseio/mempool.git
- `upstream` -> https://github.com/mempool/mempool.git (push URL disabled locally)

## Scheduled process

A scheduled GitHub Actions workflow (`.github/workflows/upstream-sync.yml`) runs
weekly and on manual dispatch. It:

1. fetches `upstream` (tags included);
2. compares the pinned base (`upstream-base.json`) against current upstream
   `master` and the latest stable release tag;
3. when new upstream commits exist, opens or refreshes a branch
   `sync/upstream-<date>` containing `git merge upstream/<target>` on top of
   `develop` (conflicts committed as-is markers are NOT allowed - if the merge
   conflicts, the workflow stops and reports the conflicting paths instead);
4. runs the upstream unit suites and the Universe suites on the sync branch;
5. opens a draft pull request into `develop` with the diff summary, test results,
   and conflict report;
6. never merges automatically. A human reviews and lands the PR.

## Review rules

- Do not import upstream branding, sponsor, enterprise, or accelerator additions
  into the public Universe surface; the trademark audit
  (`docs/legal/TRADEMARK-AUDIT.md`) must stay green after every sync.
- Update `upstream-base.json` and `UPSTREAM.md` (base commit, release, conflicts)
  in the same PR that lands a sync.
- Universe changes live in isolated modules (`backend/src/universe/`,
  `frontend/src/app/universe/`) precisely so that syncs stay mergeable; if a sync
  repeatedly conflicts inside an upstream file, consider moving the Universe edit
  behind a smaller hook in that file.

## Manual sync (fallback)

```bash
git fetch upstream --tags
git checkout -b sync/upstream-$(date +%Y%m%d) develop
git merge upstream/master   # or the chosen release tag
# resolve conflicts, run tests, open PR into develop
```

Never force-push, never rebase published history, never merge a sync branch that
fails either test suite.
