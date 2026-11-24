# 0023. Device sources behind ports: several gateways now, Matter later

## Context

One Zigbee coordinator covers one network. A garage, a garden house or thick walls may need a second gateway, with its own network. Later, Thread devices will come through Matter, a different technology with its own controller. Rules, actions, rooms, light groups, history and the app should not change for either.

## Decision

- **Hexagonal: the core talks to ports, adapters talk to devices.** The core uses only the ports `DeviceControl` and `GroupControl` ([0015](0015-modular-monolith.md)): control, state and events per device, and light groups. Each device source is an adapter behind those ports. Today that is one Zigbee2MQTT bridge per gateway; a Matter controller (matter.js, in Node like the hub) will be another.
- **A router presents all sources as one** (`device-sources.ts`). It sends each command to the source that knows the device, passes on every source's events (a gateway's coming and going carries its id), and merges their devices and groups. The core never learns which gateway or technology a device is on.
- **Several Zigbee gateways.** Each gateway is its own Zigbee network with its own coordinator, channel, network key, Zigbee2MQTT and backup.
  - The list of gateways is `networks.json` in the private folder, with an id (1–9) and a name each. Gateway 1 always exists, and keeps the files it always had (`coordinator`, `gateway.json`, `zigbee2mqtt/`, MQTT base topic `zigbee2mqtt`). Gateway *n* adds `-n` to each.
  - The supervisor runs one Zigbee2MQTT per gateway, and restarts them when the hub changes the list.
  - A new gateway starts on channel 20, away from the first one's 25.
  - Devices join through the gateway chosen in "Add devices". Only one network is open at a time.
- **Groups across gateways.** Zigbee group ids are per network, so the router shows group *g* of gateway *n* as `(n − 1) × 65536 + g`; gateway 1's ids are unchanged. A light group with lights on several gateways is one Zigbee group of the same name on each. A command goes to every part at once.
- **Device identity stays the device's own address.** IEEE addresses are unique across Zigbee networks. A device moved to another gateway is paired again there and keeps its name, room, actions and rules. Matter devices will need ids of their own; the router's `sourceOf` is where that will be decided, without changing the core.

## Alternatives considered

- **One Zigbee2MQTT with several adapters.** Zigbee2MQTT drives one coordinator per instance.
- **A source field on every device in the database.** The router learns it from the sources themselves, so a device that moves needs no migration. It can be stored later, if Matter needs it.

## Consequences

- Gateway alarms name the gateway. The header light is green only when every gateway is connected.
- The Gateway page lists the gateways and shows one at a time: address, settings, backup and replacement are per gateway.
- The check of the gateway's web page and its hardening ([0007](0007-gateway-backup-and-replacement.md)) apply to each gateway's page; the anonymous web page check runs for the first gateway.
