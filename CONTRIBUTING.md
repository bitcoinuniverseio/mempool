# Contributing to Universe Explorer

This repository is Bitcoin Universe's fork of the Mempool Open Source Project,
released under the AGPL. Contributions to it are contributions to this fork.
The upstream project's own contribution terms are preserved further down, and
they govern work you submit to that project rather than to this one.

## Where work happens

`develop` is the working branch. Open a pull request against it. `main` is the
released branch and is protected: it only ever moves through a promotion from
`develop`.

## Scope conventions

Universe changes live in `frontend/src/app/universe/`, `scripts/universe/`, and
`docs/`, and reach the inherited application through a small number of
documented integration points. Keeping them there is what makes upstream
security fixes easy to take. `UPSTREAM.md` records every subsystem this fork
modifies and the known conflict points, and
`docs/operations/UPSTREAM-SYNC.md` is the synchronization procedure.

## What the checks hold you to

Run these before opening a pull request. They are the same ones
`.github/workflows/universe-ci.yml` runs.

```bash
cd frontend && npm ci && npm run lint && npm run test && npm run build:universe
cd backend && npm ci && npm run lint && npm run test:ci
node scripts/universe/generate-protocol-coverage.mjs --check
node scripts/universe/check-text.mjs
node scripts/universe/check-colors.mjs
node scripts/universe/check-palettes.mjs
node scripts/universe/check-fills.mjs
node scripts/universe/check-branding.mjs
node scripts/universe/check-origins.mjs
node --test scripts/universe/gateway.test.mjs
```

Four of them are easy to trip by accident, so they are enforced rather than
remembered:

- **No em dash.** Use a colon, a comma, or two sentences. The word "canonical"
  is also out of the vocabulary here.
- **No raw interface colour.** Everything comes from the tokens in
  `frontend/src/styles/_universe-tokens.scss`, including in style bindings.
  Every strong fill declares the ink that goes on it.
- **No third-party data origin.** Not in the source, not in the built bundle,
  not as a fallback. `docs/data/ASSET-EVIDENCE.md` explains why.
- **No obsolete upstream product mark** outside the allowlist recorded in
  `docs/legal/TRADEMARK-AUDIT.md`.

## If you add or change a page

Add it to the visual matrix in `scripts/universe/visual-qa/`. A route with no
fixture is a route no screenshot, contrast probe or unfinished-page check ever
looks at, and every defect this product has shipped visually was on a surface
in exactly that position. `docs/product/DESIGN-SYSTEM.md` has the account of
what that has cost, at the end.

## Writing

`docs/product/DESIGN-SYSTEM.md` has the rules the copy is held to. The short
version: say what is true and no more, distinguish "there is none" from "we
could not tell", keep exact figures exact, and explain a term at the moment it
matters rather than in a glossary.

## Reporting a vulnerability

Privately, to the Bitcoin Universe security contact, rather than in a public
pull request. `docs/security/THREAT-MODEL.md` records the trust boundaries this
deployment assumes.

---

# Contributing to The Mempool Open Source Project

Thank you for contributing to The Mempool Open Source Project managed by Mempool Space K.K. (“Mempool”).

In order to clarify the intellectual property license granted with Contributions from any person or entity, Mempool must have a statement on file from each Contributor indicating their agreement to the Contributor License Agreement (“Agreement”). This license is for your protection as a Contributor as well as the protection of Mempool and its other contributors and users; it does not change your rights to use your own Contributions for any other purpose.

When submitting a pull request for the first time, please create a file with a name like `/contributors/{github_username}.txt`, and in the content of that file indicate your agreement to the Contributor License Agreement terms below. An example of what that file should contain can be seen in wiz's agreement file. (This method of CLA "signing" is borrowed from Medium's open source project.)

Also, please GPG-sign all your commits (`git config commit.gpgsign true`).

# Contributor License Agreement

Last Updated: January 25, 2022

By accepting this Agreement, You agree to the following terms and conditions for Your present and future Contributions submitted to Mempool. Except for the license granted herein to Mempool and recipients of software distributed by Mempool, You reserve all right, title, and interest in and to Your Contributions.

### 1. Definitions

“You” (or “Your”) shall mean the copyright owner or legal entity authorized by the copyright owner that is making this Agreement with Mempool. For legal entities, the entity making a Contribution and all other entities that control, are controlled by, or are under common control with that entity are considered to be a single Contributor. For the purposes of this definition, “control” means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

“Contribution” shall mean any original work of authorship, including any modifications or additions to an existing work, that is intentionally submitted by You to Mempool for inclusion in, or documentation of, any of the products owned or managed by Mempool (“Work”). For the purposes of this definition, “submitted” means any form of electronic, verbal, or written communication sent to Mempool or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, Mempool for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by You as “Not a Contribution.”

### 2. Grant of Copyright License

Subject to the terms and conditions of this Agreement, You hereby grant to Mempool and to recipients of software distributed by Mempool a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works.

### 3. Grant of Patent License

Subject to the terms and conditions of this Agreement, You hereby grant to Mempool and to recipients of software distributed by Mempool a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Work to which such Contribution(s) was submitted. If any entity institutes patent litigation against You or any other entity (including a cross-claim or counterclaim in a lawsuit) alleging that your Contribution, or the Work to which you have contributed, constitutes direct or contributory patent infringement, then any patent licenses granted to that entity under this Agreement for that Contribution or Work shall terminate as of the date such litigation is filed.

### 4. Authority

You represent that you are legally entitled to grant the above license. If your employer(s) has rights to intellectual property that you create that includes your Contributions, you represent that you have received permission to make Contributions on behalf of that employer, that your employer has waived such rights for your Contributions to Mempool, or that your employer has executed a separate Corporate Contributor License Agreement with Mempool.

### 5. Originality

You represent that each of Your Contributions is Your original creation (see section 7 for submissions on behalf of others). You represent that Your Contribution submissions include complete details of any third-party license or other restriction (including, but not limited to, related patents and trademarks) of which you are personally aware, and which are associated with any part of Your Contributions.

### 6. Support

You are not expected to provide support for Your Contributions, except to the extent You desire to provide support. You may provide support for free, for a fee, or not at all. Unless required by applicable law or agreed to in writing, You provide Your Contributions on an “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON- INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

### 7. Third Party Contributions

Should You wish to submit work that is not Your original creation, You may submit it to Mempool separately from any Contribution, identifying the complete details of its source and of any license or other restriction (including, but not limited to, related patents, trademarks, and license agreements) of which you are personally aware, and conspicuously marking the work as “Submitted on behalf of a third-party: [named here]”.

### 8. Notifications

You agree to notify Mempool of any facts or circumstances of which you become aware that would make these representations inaccurate in any respect.
