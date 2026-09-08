# Address portfolio

The address portfolio is a read-only, ephemeral view for one explicit public
address. It creates no vault record and saves no local history.

## Route

| Route | Purpose |
| --- | --- |
| `/portfolio/:chain/:network/:address` | Loads one address on the chain and network supplied in the path. |

The route does not infer a chain from the address. Portfolio onboarding
validates the pasted address and chooses the explicit chain and network path
before navigating here.

## What the page loads

The page makes three concurrent reads through the same-origin Portfolio v2
API:

- the address summary and priced-value state;
- the first holdings page, limited to 100 entries;
- semantic activity, of which the page shows at most 10 recent events.

All three reads must succeed before the result is displayed. If any required
read fails, the page displays the failure and does not turn it into an empty
portfolio or a zero balance.

The visible result contains the truncated public address, priced value and
evidence state, a holdings table, and recent activity. A link leads to
`/portfolio/new` for visitors who want to create a saved portfolio.

## Value privacy

The session value control has two states: shown and hidden. Hidden mode
replaces quantities and absolute values with placeholders. It does not hide
the public address or claim to protect identifiers. The control is a display
mask, not encryption or access control.

## Current boundaries

This page has no tabs, saved labels, snapshots, portfolio-wide performance,
profit and loss, source roster, report export, alert subscription, manual
position, watch-only discovery, or share creation. Performance is available
only on saved portfolios and is requested separately for each explicit
address. Watch-only key and descriptor discovery, manual positions, and all
share operations are unavailable in this release.

The page reads `/api/v2/universe/portfolio` through the explorer gateway. If
that production API path is unavailable, the page reports the request
failure.
