# Recovering legacy observed fees

The October 11 Mainnet snapshot passed its gzip CRC, network envelope and body
checksum. The original validator rejected 22 of 50,000 events because their
`fee_sats` values differed from an integer by one floating-point ULP. The original
emitting revision is unknown. All 17 checkpoints and all other predicates passed.

`migrateObservedFeeNoise` is an explicit operator migration, never an automatic
fallback in the reader. It creates new event records, preserves the input, and
accepts only nonnegative safe-integer fees within both one relative epsilon and
one millionth of a satoshi. Both the original and normalized fee must produce the
same recorded fee rate. It then runs the complete unchanged history validator.
Ambiguous fractions, changed rates and every unrelated invalid field fail closed.

Before publication, drain the sole observer and preserve its complete current
observations. Retain the original compressed snapshot and its checksum in an
immutable rollback namespace. Qualify the migrated candidate, retain a receipt
with source and output checksums and changed-event count, and fsync the candidate
and its directory before atomic publication. Reconcile any later real observations
with an explicit restart gap and retain their original forensic snapshot. Never
overwrite the original, drop observations silently, reset history availability,
or use the migration result as functional acceptance evidence.

The producer uses the same narrow integer-fee conversion before recording new
events. The reader's integer, identity, ordering, network and history limits remain
unchanged. Component coverage includes original-byte preservation, full-validator
acceptance, idempotence, negative controls and durable reopen of a real observation.
