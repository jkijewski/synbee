# 0015. A modular monolith with ports at the edges

## Decision

- **One process, one module per area:** devices, rooms, light groups, actions, rules (with the rule engine), history, energy, notifications, gateway, import and auth. Each module is a file with a class that validates and stores its own data.
- **One owner per table.** Only the owning module writes a table; other modules call its methods. A change that spans modules is a small function that calls each owner inside one transaction.
- **Ports at the edges.** `ports.ts` defines `DeviceControl` (state, commands, refresh, rename, interview, configure, leave), `GroupControl` (Zigbee groups) and typed device events (`state`, `button`, `availability`, `device-joined`, `gateway`). Modules and most routes depend on these; the Zigbee2MQTT bridge implements them over MQTT, and tests use an in-memory fake. Only the composition root, the gateway module and the gateway routes use the bridge itself, for pairing, bridge information and Zigbee2MQTT requests.
- **Thin routes:** one route file per area parses requests, calls modules and shapes replies, with no SQL.
- **A pure core** (`features/`, `exposes.ts`, `buttons.ts`, `device-icons.ts`, `device-kinds.ts`, `ports.ts`, `rule-match.ts`) touches no storage, network or adapters, so the web UI can share it.
- **Checked by a test:** `hub/test/architecture.test.ts` fails when a file writes a table it doesn't own, a route runs SQL, the pure core imports storage or network code, Fastify or the bridge is used outside the allowed places, or imports form a cycle.

## Alternatives considered

- **Layered architecture.** Organises code by technical layer, so each change touches several folders.
- **Hexagonal architecture everywhere.** Interfaces for every small module would triple the files for no gain.
- **Microservices.** One NAS and one household; the supervisor's process split is enough.

## Consequences

- Rules, actions and groups can be tested without MQTT; the simulator stays for integration tests.
- Another device source (another radio, Wi-Fi devices) would implement the same ports.
