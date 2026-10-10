# UI follow-up, 10 October 2026

Production review found missing fiat prices displayed as negative amounts and an invalid update time, faint Clock block numbers, an address prefix wrapping after its suffix, and inconsistent QR activation.

The calculator keeps Bitcoin and satoshi conversion usable when a fiat price is unavailable. It accepts only finite positive prices, omits invalid timestamps, labels inputs and copy actions, and preserves the entered Bitcoin amount when a quote recovers. Shared fiat displays apply the same price validity rule.

Clock block numbers use a contrast backing over the transaction map, and route subscriptions end when the Clock closes. Address text retains its canonical accessible value and coherent truncation; QR visibility belongs to the current address. Copy controls support keyboard and mobile use and report success or failure accurately. Mobile holdings expose the same location details as desktop, and incomplete empty results do not claim that no holdings exist.

Address reads and live updates are fenced to the accepted address/network route. A pending network transition cancels the old read chain and clears its displayed values; canceled navigation cannot relabel the previous network's results. Existing request and response budgets remain in force.

The protocol directory distinguishes an unavailable status check from a confirmed count of zero readable protocols. Its retry text uses plain language.

Regression checks cover quote loss and recovery, clipboard failure and teardown, QR activation, address identity, Clock lifecycle and contrast, and incomplete holdings. Desktop/mobile rendering and all three themes must be checked against the built artifact. These UI repairs do not establish native protocol history or full functional acceptance.
