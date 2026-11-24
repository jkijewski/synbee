# Changelog

Package versions are `X.Y.Z-NNNN`: the release, and a build number that only goes up.

## 1.1.0 (24 November 2026)

- Sensor groups: several yes/no sensors read as one state in your own words ("All closed", "2 of 5 open: Kitchen, Hall")
- Checks: your own named statements from conditions, true or false in your words and colours, explained
- Status tiles in the Android app: devices you pick, sensor groups and checks, per person; temperatures coloured, in °C or °F
- Actions with "Only when": unmet conditions stop the action and say why
- Alerts to Synology Chat, by level; app users you allow can pause them
- Automations start on sensor groups and checks; notification texts with {device}, {state}, {duration}, {check}, {why}
- Header: Groups tab, and an Administration menu for Add devices, Import from Tuya, Gateway and Status

## 1.0.0 (24 November 2026)

- Zigbee devices through Zigbee2MQTT with a network coordinator, with controls built from each device's capabilities
- Rooms, light groups, actions and WHEN / IF / THEN automations
- Several gateways, each its own Zigbee network, with backups and guided coordinator replacement
- Harden gateway security: SynBee checks and sets an SLZB gateway's protections with its login
- App users and the SynBee Android app: pairing by QR code, per-room and per-action access, use away from home when allowed
- App API described as an OpenAPI 3.1 document, generated and checked by tests
- Safety copies before upgrades: the database before each migration, Zigbee2MQTT data before each package upgrade
- History, energy, attention list and notifications; optional import from Tuya
