# Test fixtures

`webhook-receiver.crt` and `webhook-receiver.key` are a self-signed
certificate for `localhost` used only by `developer-identity.test.ts` to run a
TLS receiver on the loopback interface, so the real HTTPS delivery transport
is exercised end to end (TLS handshake, signature headers, response handling).
They protect nothing and are not used by any runtime.
