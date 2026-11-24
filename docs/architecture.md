# Architecture

How SynBee is put together. The reasons behind each part are in the [decision records](decisions/README.md).

## Processes

```
 DSM Package Center
        │ start-stop-status
        ▼
 ┌──────────────── supervisor (Node.js) ─────────────────┐
 │  MQTT broker (Aedes), 127.0.0.1:18830, password       │
 │        ▲                         ▲                    │
 │        │ MQTT                    │ MQTT               │
 │  ┌─────┴──────┐           ┌──────┴───────┐            │
 │  │    hub     │           │ Zigbee2MQTT  │── TCP ──▶ coordinator (e.g. SLZB-06M)
 │  └──┬──────┬──┘           └──────────────┘            │
 └─────┼──────┼──────────────────────────────────────────┘
       │      │
   :8090      :8443 (TLS)
   web        phone app
   home only  home, and away when allowed
```

- **Supervisor** (`hub/supervisor/`): starts the hub and Zigbee2MQTT, restarts them with backoff, runs the MQTT broker, writes logs and a health file ([0003](decisions/0003-supervisor-and-processes.md)).
- **Hub** (`hub/src/`): the web interface and its API, the app API, the database and the rule engine.
- **Zigbee2MQTT** (pinned in `hub/zigbee2mqtt/`): the radio stack, one per gateway ([0023](decisions/0023-device-sources.md)). Each talks to its coordinator over TCP and to the hub only over MQTT ([0002](decisions/0002-zigbee2mqtt-and-network-coordinator.md)).

## Hub modules

The hub is a modular monolith ([0015](decisions/0015-modular-monolith.md)): one module per area, each owning its tables.

| Area | Module | Owns |
| --- | --- | --- |
| Devices | `devices.ts` | `devices`, `channel_labels` |
| Rooms and photos | `rooms.ts` | `rooms`, `device_rooms`, the room column of `devices` |
| Light groups | `groups.ts` | `light_groups` |
| Actions | `actions.ts` | `actions`, `action_steps` |
| Rules | `rules.ts`, `rule-engine.ts`, `rule-match.ts`, `rule-describe.ts`, `rule-runs.ts`, `rule-durations.ts`, `rule-later.ts` | `rules`, `rule_runs`, `duration_timers`, `later_steps` |
| History | `history.ts` | `readings_raw`, `readings_5m`, `readings_1h`, `value_since` |
| Energy | `energy.ts` | `energy_daily`, `energy_counter` |
| Notifications | `notifications.ts` | `notifications` |
| Settings | `settings.ts` | `settings` |
| Admin sign-in | `auth.ts` | `users`, `sessions` |
| App members and phones | `members.ts`, `tls.ts` | `members`, `member_revoked_actions`, `member_revoked_rooms`, `member_phones`, `member_pairing_codes` |
| Gateways | `networks.ts`, `gateway.ts`, `coordinator.ts`, `backup.ts`, `gateway-web.ts` | files in the private folder, per gateway |
| Tuya import | `tuya-import.ts`, `tuya-export.ts` | (writes through the owners) |
| Related items | `related.ts` | (read model) |

- **Composition:** `index.ts` builds everything once. `server.ts` (web listener) registers the route files in `routes/`, one per area, which contain no SQL. `app-server.ts` is the app listener, with only the app API ([0021](decisions/0021-app-api.md)).
- **Ports and adapters** (`ports.ts`, [0023](decisions/0023-device-sources.md)): `DeviceControl` and `GroupControl` are what modules need from devices; typed `DeviceEvents` (`state`, `button`, `availability`, `device-joined`, `gateway`) are how they hear from them. Each device source is an adapter: one Zigbee2MQTT bridge (`zigbee.ts`) per gateway, later Matter. The router (`device-sources.ts`) presents them as one to the core. Tests use `test/fake-devices.ts`.
- **Pure core,** shared with the web UI:
  - `features/`: one module per kind of device property ([0008](decisions/0008-device-capabilities-and-features.md));
  - `exposes.ts`: reading Zigbee2MQTT's capability descriptions;
  - `buttons.ts`: remote button names;
  - `device-kinds.ts`: friendly names, fades, Tuya datapoint devices and safe retries ([0009](decisions/0009-device-commands.md));
  - `device-icons.ts`, `rule-match.ts` and `sun.ts` (sunrise and sunset, computed locally).
- **Watchers** (`device-watchers.ts`) record history and energy from device events, notify about alarms and a lost gateway, and run the hourly roll-up.
- `test/architecture.test.ts` checks these rules on every test run.

## Web interface

React, served by the hub from `hub/dist-web`, one page per area in `hub/web/src/`: Devices, Rooms, Actions, Automations (`rules/`), Light groups, Add devices, Import from Tuya, Gateway, App users and Status. Data comes through `api.ts` and the `useApi` hook. Device controls and editors come from `web/src/features/`, which wrap the hub's feature modules. Pages open by address (`#devices/<ieee>`, `#actions/<id>`, …). The header shows the gateway light and the notification bell.

## Data

| What | Where | Why |
| --- | --- | --- |
| Hub database (`hub.db`) and room photos | `synbee` folder in the shared folder chosen at install | Backed up with DSM's tools; no secrets |
| TLS key of the app listener, MQTT password, coordinator address, gateway web logins | Package's private folder (`/var/packages/synbee/var/secrets`) | Not readable through a share |
| Safety copies before upgrades: `hub.db.before-v…` next to the database, Zigbee2MQTT data in `…/var/snapshots` | Last 3 of each | A way back from a bad upgrade |
| Zigbee2MQTT data: configuration with the network key, coordinator backup, device database | Package's private folder (`…/var/zigbee2mqtt`) | Every copy of the network key stays private |
| Logs | Package's private folder (`…/var/logs`), shown in the Status page with key lines hidden | |

See [0006](decisions/0006-data-and-secrets.md) and [0007](decisions/0007-gateway-backup-and-replacement.md).

## Security model

- **One listener (8090), home network only:** private source addresses only; home host names only (no DNS rebinding); same-origin changes only; owner sign-in for every API route except health and sign-in, checked on the matched route ([0005](decisions/0005-home-network-only.md)).
- **App listener (8443):** TLS with the hub's own key, pinned by the app from the pairing QR code; only the app API, described in [`openapi/app-api.json`](../openapi/app-api.json); rate limits; a revocable token per paired phone, stored as a hash; nothing that changes configuration. From outside the home network only when the owner switches on "Using the app away from home" and allows that phone; pairing works from anywhere with a one-time code ([0020](decisions/0020-app-members-and-pairing.md), [0021](decisions/0021-app-api.md)).
- **Router:** the web port is never forwarded; the app port only for using the app away from home.
- **Gateways:** SynBee checks and hardens each SLZB gateway's own protections with its web login ([0007](decisions/0007-gateway-backup-and-replacement.md)).
- **Package:** runs as its own unprivileged user; the broker and Zigbee2MQTT listen on 127.0.0.1 only; secrets outside every share.
- **Risky actions:** unlocking asks first; downloading the network backup needs the admin password and a passphrase; changing the Zigbee channel needs a confirmation.

## How a button press becomes a light change

1. The remote's message reaches the coordinator; Zigbee2MQTT publishes it on MQTT.
2. The bridge turns it into a `button` event with a normalised press (`single_click`, …).
3. The rule engine matches enabled rules, checks their conditions and runs their steps.
4. A step calls `DeviceControl.command` or `GroupControl.groupCommand`. The bridge publishes the values, waits for the device's report (retrying once if safe) and the rule's history records the result.

## Repository layout

| Folder | Contents |
| --- | --- |
| `hub/src` | Hub service (TypeScript) |
| `hub/web` | Web interface (React) |
| `hub/supervisor` | Supervisor and Zigbee2MQTT settings |
| `hub/zigbee2mqtt` | Pinned Zigbee2MQTT (`package.json` and lockfile) |
| `hub/test` | Unit and integration tests (Vitest), with the Zigbee2MQTT simulator in `hub/src/sim` |
| `package/synbee-spk` | DSM package build: scripts, wizards, icons, `build.sh` |
| `openspec/specs` | Requirements per capability |
| `openapi` | The app API as an OpenAPI 3.1 document, generated from `hub/src/app-api-schema.ts` |
| `tools/tuya-export` | Read-only exporter of a Tuya configuration, for the import |
| `third-party/sources` | Source of the bundled GPL components |
