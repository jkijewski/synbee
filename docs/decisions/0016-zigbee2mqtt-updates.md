# 0016. Zigbee2MQTT updates ship as package versions

## Decision

- Zigbee2MQTT is installed from a lockfile at build time (`hub/zigbee2mqtt/`). It never follows a moving tag or updates itself.
- A new Zigbee2MQTT version means a new SynBee package version, built, tested and installed by the owner from Package Center. The owner downloads a coordinator backup first ([0007](0007-gateway-backup-and-replacement.md)).
- **Rollback:** DSM refuses an older version over a newer one, so rolling back means uninstalling with data kept and installing the older package, with the copies taken before the upgrade ([0006](0006-data-and-secrets.md)).
- The source of every bundled GPL component is updated with it ([0019](0019-licensing.md)).
- **Not included:** a release check, a guided update from inside SynBee, uploading external converters, and device firmware updates. SynBee never starts a device firmware update, since an interrupted one can break a device. The [device support spec](../../openspec/specs/device-support-updates/spec.md) states what is required if they are added.

## Consequences

- New device support arrives with SynBee releases, not on its own.
