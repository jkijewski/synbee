# SynBee

Zigbee and home automation management system for Synology DSM, with local storage.

SynBee turns a Synology NAS into a private Zigbee hub. It controls Zigbee switches, lights, sensors and remotes, with no vendor cloud and without the internet. It runs as a native DSM package, uses [Zigbee2MQTT](https://www.zigbee2mqtt.io/) with a network Zigbee coordinator as its radio. It is set up from a browser on the home network, and has an Android app for the people who live there (a [separate project](docs/decisions/0022-android-app.md)).

> **Status:** beta. The DSM package, the hub and its web interface work. See [what works today](docs/product.md#status).

## Features

- **Devices:** everything Zigbee2MQTT supports, with controls built from each device's capabilities: lights (brightness, white temperature, colour, fades), switches, remotes, sensors with readable words ("Open", "Wet"), locks with a confirmation before unlocking, settings and diagnostics.
- **Rooms:** one main room per device, more as an option, with colours and photos.
- **Light groups:** switch several lights with one command.
- **Automations:** WHEN / IF / THEN rules built from lists, with "for N minutes", run history, a Test button and notifications.
- **Actions:** named one-tap commands that switch devices and light groups, optionally only when conditions hold ("Not run: Roof window is Open"), also usable as automation triggers.
- **Sensor groups and checks:** several sensors read as one state ("Windows: all closed"), and your own named statements ("Ready to leave") in your words, for tiles, automations and actions.
- **App users:** members paired by QR code, each allowed every action, room and status tile until the owner takes something away; status tiles show devices, sensor groups and checks in each room.
- **History and energy:** graphs per reading, and kWh per day for metered devices.
- **Attention, notifications and alerts:** leaks, smoke, low batteries, offline devices and a lost gateway, in one list and an inbox, and alerts to your phone through Synology Chat, which app users you allow can pause.
- **Gateway:** status, network map, encrypted backup download and restore, and a guided coordinator replacement without pairing devices again.
- **Import from Tuya (optional):** bring over names, rooms, groups, scenes and automations from a Tuya gateway.
- **Private by design:** nothing leaves your network. SynBee makes no outside connections of its own, the web interface answers only on the home network, and secrets stay out of shared folders. (If you use the Android app away from home, you forward one port and allow each phone; the app's requests then travel over the internet to your NAS, encrypted with TLS to SynBee's own key.)

## Requirements

- Synology NAS with DSM 7.2 or later. Intel and AMD models are supported; a 64-bit ARM build exists but is untested.
- A network Zigbee coordinator, for example an SMLIGHT SLZB-06M with EmberZNet firmware.

## Documentation

| Document | Contents |
| --- | --- |
| [User guide](docs/user-guide.md) | Concepts, installing, pairing, rooms, actions, automations, the phone app: step by step, with pictures |
| [Installation](docs/installation.md) | Installing, first steps, router, updating, uninstalling |
| [Importing from Tuya](docs/import-from-tuya.md) | Bringing devices and automations over from a Tuya gateway |
| [Product](docs/product.md) | What SynBee is for, goals, status |
| [Architecture](docs/architecture.md) | Processes, modules, data and security model |
| [Decisions](docs/decisions/README.md) | Why it is built this way |
| [Specifications](openspec/specs/) | Requirements per capability |
| [App API](openapi/app-api.json) | The API the Android app uses, as an OpenAPI 3.1 document (generated, checked by tests) |
| [Building and testing](docs/building.md) | Development, tests, package build, release checks |
| [Releasing](docs/package-center.md) | Making a release, GitHub releases and Package Center submission |
| [Changelog](CHANGELOG.md) | What changed in each version |
| [Adding a device feature](docs/adding-a-feature.md) | Supporting a new kind of device property |
| [Pitfalls and principles](docs/pitfalls.md) | Transition risks, device and platform quirks SynBee handles, and principles |

## Quick start for developers

```bash
cd hub
npm ci
npm test
npm run build
SIM=1 SIM_LIGHTS=1 SIM_SENSORS=1 HUB_DATA=/tmp/synbee-dev node supervisor/supervisor.mjs
```

Then open http://127.0.0.1:8090. To build the DSM package, run `package/synbee-spk/build.sh 1.0.0-0001 x86_64`.

## Support

Questions and problems: [GitHub issues](https://github.com/jkijewski/synbee/issues) or jacek.kijewski.gdynia@gmail.com. If SynBee is useful to you, you can [buy me a coffee](https://buycoffee.to/jacek-kijewski).

## Trademarks

SynBee is an independent project, not affiliated with or endorsed by Synology Inc. Synology, DSM and Synology Chat are trademarks of Synology Inc.; Zigbee is a trademark of the Connectivity Standards Alliance.

## Disclaimer

SynBee is provided "as is", without any warranty. Its authors accept no responsibility or liability for it under any circumstances; you use it entirely at your own risk. See [DISCLAIMER.md](DISCLAIMER.md).

## Licence

SynBee is licensed under the [MIT licence](LICENSE). The package bundles third-party software under its own licences, including Zigbee2MQTT under the GPL v3; their complete sources are in [third-party/sources](third-party/sources/README.md).
