# Changelog

Package versions are `X.Y.Z-NNNN`: the release, and a build number that only goes up.

## 1.0.0 (unreleased)

- Zigbee devices through Zigbee2MQTT with a network coordinator, with controls built from each device's capabilities
- Rooms, light groups, actions and WHEN / IF / THEN automations
- Several gateways, each its own Zigbee network, with backups and guided coordinator replacement
- Harden gateway security: SynBee checks and sets an SLZB gateway's protections with its login
- App users and the SynBee Android app: pairing by QR code, per-room and per-action access, use away from home when allowed
- App API described as an OpenAPI 3.1 document, generated and checked by tests
- Safety copies before upgrades: the database before each migration, Zigbee2MQTT data before each package upgrade
- History, energy, attention list and notifications; optional import from Tuya
