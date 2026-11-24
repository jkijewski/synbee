# Decision records

Each record states one decision about how SynBee is built, as it is now: the context, the decision, the alternatives considered and the consequences. Records are updated in place when a decision changes; they hold no history. What SynBee is for is in the [product description](../product.md), and how the pieces fit together in the [architecture overview](../architecture.md).

| # | Decision |
|---|---|
| 0001 | [A native DSM package, ready for Package Center](0001-native-dsm-package.md) |
| 0002 | [Zigbee2MQTT with a network Zigbee coordinator](0002-zigbee2mqtt-and-network-coordinator.md) |
| 0003 | [One supervisor, with the MQTT broker inside it](0003-supervisor-and-processes.md) |
| 0004 | [TypeScript on a bundled Node.js 22, with SQLite](0004-technology-stack.md) |
| 0005 | [The web interface, on the home network only](0005-home-network-only.md) |
| 0006 | [Data in a shared folder, secrets in the package's private folder](0006-data-and-secrets.md) |
| 0007 | [The gateway page, its backup and replacement](0007-gateway-backup-and-replacement.md) |
| 0008 | [Device capabilities from Zigbee2MQTT, handled by feature modules](0008-device-capabilities-and-features.md) |
| 0009 | [How commands are sent and confirmed](0009-device-commands.md) |
| 0010 | [Automations as WHEN / IF / THEN rules in the hub](0010-rules.md) |
| 0011 | [Actions: named one-tap commands](0011-actions.md) |
| 0012 | [Rooms: one main room per device, more as an option](0012-rooms.md) |
| 0013 | [Related items and delete warnings from one dependency index](0013-related-items.md) |
| 0014 | [Reading history, energy totals and notifications](0014-history-energy-notifications.md) |
| 0015 | [A modular monolith with ports at the edges](0015-modular-monolith.md) |
| 0016 | [Zigbee2MQTT updates ship as package versions](0016-zigbee2mqtt-updates.md) |
| 0017 | [Importing from a Tuya gateway](0017-tuya-import.md) |
| 0018 | [Three test levels](0018-test-levels.md) |
| 0019 | [MIT licence, bundled GPL sources and no warranty](0019-licensing.md) |
| 0020 | [App members, paired by QR code](0020-app-members-and-pairing.md) |
| 0021 | [The app API: its own TLS listener, at home and away](0021-app-api.md) |
| 0022 | [The Android app is a separate project](0022-android-app.md) |
| 0023 | [Device sources behind ports: several gateways now, Matter later](0023-device-sources.md) |
| 0024 | [Sensor groups, checks and status tiles](0024-sensor-groups-and-checks.md) |
| 0025 | [Alerts leave the hub through Synology Chat](0025-alerts-through-synology-chat.md) |
