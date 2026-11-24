# 0018. Three test levels

## Decision

1. **Development without DSM:** the hub against a Zigbee2MQTT simulator (`SIM=1`, with optional simulated lights and sensors), unit and integration tests with Vitest, and the web UI in a browser.
2. **Package tests on Virtual DSM:** install, upgrade, stop, start, uninstall and Synology's review checks, on a Virtual DSM kept off the LAN and never pointed at a real coordinator.
3. **A real NAS with a real coordinator,** only with a backup.

## Consequences

- Most behaviour is tested without hardware. Device quirks found on real networks become simulator cases and tests ([0009](0009-device-commands.md)).
