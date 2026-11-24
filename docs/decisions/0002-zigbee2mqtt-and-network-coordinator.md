# 0002. Zigbee2MQTT with a network Zigbee coordinator

## Context

SynBee needs a Zigbee radio and a device database that keeps up with new devices from many vendors.

## Decision

- **Zigbee2MQTT is the radio stack,** bundled at a pinned version ([0016](0016-zigbee2mqtt-updates.md)). Its device database decides which devices are supported and what each can do. The hub talks to it only over MQTT.
- **The coordinator is a network-connected radio,** such as an SMLIGHT SLZB-06M with EmberZNet firmware. Zigbee2MQTT reaches it over TCP (`host:port`).
- Zigbee2MQTT starts only when a coordinator address is set, so a fresh install never reaches for a radio by itself.
- **One coordinator per network.** Routers (mains-powered devices) extend the range; a second coordinator is not supported.
- A new network uses channel 25, above Wi-Fi channel 11. The channel can be changed later only after confirming that devices may need pairing again.

## Alternatives considered

- **A USB coordinator.** DSM 7 has no reliable USB serial support for packages, and the NAS is rarely the best place for the radio.
- **Writing a Zigbee stack.** Zigbee2MQTT's device database is the main value; reproducing it isn't realistic.
- **Other stacks (ZHA, deCONZ).** They are tied to Home Assistant or to their own hardware.

## Consequences

- Only one program can use the coordinator at a time. Anything else connected to it must be stopped first.
- Device support follows Zigbee2MQTT releases.
