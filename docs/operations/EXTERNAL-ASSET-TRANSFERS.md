# Startup asset transfers

Configured `MEMPOOL.EXTERNAL_ASSETS` are downloaded sequentially before startup completes. Each URL must name a regular filename without URL credentials. The existing SOCKS proxy configuration remains supported.

A transfer has a 30-second total deadline and a 128 MiB decoded byte limit. It writes an exclusive, uniquely named sibling file and replaces the destination only after the response stream completes. HTTP errors, truncated bodies, stalled streams, size overruns and filesystem failures reject startup and preserve the previous destination. Temporary files are removed after failure.

This repairs the earlier unresolved outer promise on asynchronous HTTP failure and direct truncation of an existing file before a successful download. It does not authenticate asset contents: operators must still select a trusted source. Transfer completion is not signature or checksum validation.

Validation uses actual loopback HTTP responses for successful replacement, HTTP 404, truncated body, stalled response, size overrun, destination errors, and unsafe filenames. Ten tests pass. No production asset or server was changed.
