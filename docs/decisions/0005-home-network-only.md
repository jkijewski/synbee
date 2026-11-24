# 0005. The web interface, on the home network only

## Context

Setup and automations happen in a browser on the home network. The hub holds the Zigbee network and its key, so it must not be reachable from the internet, and a page on the home network must not be able to misuse it.

## Decision

- **One HTTP listener (default 8090)** serves the web interface and its API.
  - Requests from addresses outside private ranges are refused.
  - Every API route except health and sign-in needs the owner's session: a server-side session in a cookie (`HttpOnly`, `SameSite=Strict`, 7 days). The password is stored with scrypt; five wrong passwords lock that address out for a minute.
  - Only home host names are accepted: an IP address, `localhost`, a single-label name, or a local suffix (`.local`, `.lan`, `.home`, `.home.arpa`, `.internal`, `.localdomain`). This stops DNS-rebinding pages; `HUB_ALLOWED_HOSTS` adds other names.
  - Changes (anything but GET) are refused when the browser's Origin isn't SynBee's own page, because another app on the same NAS counts as the same site for cookies.
  - It must never be forwarded on the router.
- **Access checks use the matched route,** not the raw URL. Fastify decodes the path when routing, so a check on the raw URL could be bypassed with percent-encoding.
- API answers are never cached (`Cache-Control: no-store`) or sniffed (`nosniff`). The web page has a Content Security Policy.
- **The web interface is never reachable from outside.** The phone app has a listener of its own, with its own protection, and only that one may be forwarded ([0021](0021-app-api.md)).

## Alternatives considered

- **DSM's reverse proxy.** Ties SynBee to DSM's web server configuration, and invites forwarding it to the internet.
- **HTTPS on the home network.** Browsers would warn about the hub's own certificate on every visit; the home network and the NAS address are the trust boundary instead.

## Consequences

- The owner opens SynBee by the NAS address or its local name. Another name pointing at the NAS needs `HUB_ALLOWED_HOSTS`.
- The web interface needs no router setting. Using the app away from home needs one forwarded port, the app's.
