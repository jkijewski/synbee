# 0017. Importing from a Tuya gateway

## Context

Many Zigbee devices are first set up on a Tuya gateway. Tuya doesn't release its network key, so devices must join SynBee's network anew, but their names, rooms and automations are worth keeping.

## Decision

- **An optional import** reads a Tuya configuration export, made by the read-only [`tools/tuya-export`](../../tools/tuya-export/README.md), or a tinytuya `devices.json` listing. It brings over:
  - rooms, in Tuya's order;
  - device names, matched by Zigbee IEEE address so a device gets its familiar name the moment it joins;
  - channel labels of multi-channel switches;
  - Zigbee groups, as planned light groups;
  - tap-to-run scenes, as draft actions;
  - automations, as disabled draft rules;
  - for remote buttons that switch lights, disabled draft rules for double press (full brightness, or off) and long press (dimmer in steps).
- **Nothing secret is stored:** Tuya local keys, tokens, account IDs and device IDs are dropped. What can't be translated is listed in an import report.
- **Devices join one at a time** through "Add devices", which keeps joining open for up to 30 minutes by re-opening Zigbee2MQTT's 254-second window. Devices not yet joined keep working on the Tuya gateway.
- **Drafts stay drafts** until their devices have joined; enabling a rule earlier is refused with the names of the missing devices.

See [importing from Tuya](../import-from-tuya.md).

## Consequences

- Tuya history, cloud-only features and schedules stored in the devices don't carry over.
- The import is a one-way starting point; SynBee never talks to Tuya.
