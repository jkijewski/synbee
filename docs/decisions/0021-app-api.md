# 0021. The app API: its own TLS listener, at home and away

## Decision

- **A second listener (default 8443)** serves only the app API, under `/api/app/v1/`. The web interface's routes don't exist there, and the app's routes don't exist on the web port.
- **TLS with the hub's own key,** an EC P-256 key and a long-lived self-signed certificate generated on first start and kept in the package's private folder. The app pins the key's SHA-256 fingerprint from the pairing QR code, so there are no certificate warnings and no domain is needed. Renewing the certificate keeps the key.
- **Home network by default; away from home when the owner allows it,** as Synology Photos does: an address of the home's internet connection (a fixed IP, or a DDNS name such as DSM's own `*.synology.me`) and a port the router forwards to the app port, switched on for the hub and for each phone ([0020](0020-app-members-and-pairing.md)). The app pins the hub's key, so the certificate needs no domain, and a server at the wrong address gets nothing. Ping and pairing are accepted from anywhere; everything else from outside only for allowed phones while away-from-home use is on. Repeatedly refused tokens block their address for a while. Only the app port is forwarded, never the web interface's.
- **Checks on the matched route,** like the web port ([0005](0005-home-network-only.md)); rate limits per address (120 requests a minute, 10 pairing attempts a minute); small bodies and short timeouts.
- **Versioned contract:** a breaking change gets a new prefix, and the old one stays for a release. The requirements are in [the app API spec](../../openspec/specs/app-api/spec.md).
- **The contract is code, and the document is generated from it.** Every route's request and answer is a JSON Schema in `hub/src/app-api-schema.ts`. The listener serializes answers and checks requests with those schemas and refuses at start a route that isn't in them; `npm run openapi` writes [`openapi/app-api.json`](../../openapi/app-api.json) (OpenAPI 3.1) from them, and a test fails when the committed document is stale. So the document can't drift from what the hub sends.

## Alternatives considered

- **The app on the web port.** Plain HTTP on Wi-Fi would expose the phone's token to anyone on the network, and one listener would mix the owner's and the members' access.
- **A certificate from a public authority.** Needs a domain and renewals, for a hub that is reached by its IP address.

## Consequences

- The package registers a second port, marked as forwardable for away-from-home use.
- Changing the hub's key means pairing every phone again.
