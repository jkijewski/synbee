# SynBee: what it is for

SynBee is a private smart home hub for Zigbee devices. It runs as an app on your own Synology NAS, with a network Zigbee coordinator as its radio, set up from a browser on the home network, with a mobile app for the people who live there. This document says what SynBee is for and what it must achieve. How it is built is in the [architecture overview](architecture.md) and the [decision records](decisions/README.md).

## Why SynBee exists

Zigbee switches, lights and sensors usually depend on a vendor's gateway, phone app and cloud. That has real costs:

- **It stops when the internet or the vendor's cloud stops.** A light switch in the next room shouldn't need a server abroad.
- **The vendor holds the keys.** The network key can't be extracted, the app decides which features exist, and the service can change or end at any time.
- **Privacy.** Every press and every state change passes through someone else's servers.
- **Automations are locked in.** They live in the vendor's app and can't be moved or backed up.

Many homes already have a Synology NAS that is always on. SynBee turns it into the hub, so devices are controlled locally, by software the owner controls.

## Who uses it

- **The owner (admin):** sets up the hub from a browser at home, adds devices, builds actions and automations, and decides who may use what in the app.
- **Members:** the people in the home, who use the mobile app to run actions and see devices. They can't change any settings.

## Goals

1. **Local control without the internet.** Devices, actions and automations keep working when the internet is down.
2. **One place for all Zigbee devices.** Every device supported by Zigbee2MQTT is added, named, put in a room and controlled in one hub, whatever its brand. Every device, action and automation shows what it is related to, and nothing is deleted without saying what uses it.
3. **Automations a casual user can build.** Rules read as "WHEN this happens, IF this is true, THEN do these steps", built by picking from lists. Each rule shows what it did and why.
4. **One-tap actions.** Named actions switch several devices and light groups at once, from the web interface or from an automation.
5. **No vendor cloud, including Synology's.** Nothing depends on a device vendor, on Synology's remote access services, or on any other vendor service. SynBee makes no outside connections of its own.
6. **Private by default.** SynBee answers only on the home network. The app can be used away from home only if the owner forwards its one port and allows it, for each phone; the web interface is never reachable from outside.
7. **A native NAS app.** SynBee installs, starts, stops, updates and uninstalls from Package Center like any other app. Updates are never automatic.
8. **Recoverable.** The Zigbee network is backed up. A failed coordinator, or a lost NAS, can be replaced without pairing every device again.

## What is not a goal

- High availability, or running on more than one NAS.
- iPhone support.
- Cloud features: remote dashboards, voice assistants, vendor integrations.
- Free-form programming in automations, such as arithmetic, loops or code.

## The main pieces

- **The hub (the Synology app).** Knows every device, runs the automations, keeps all data on the NAS, and offers a web interface on the home network and an API for the app, at home and, when allowed, away.
- **The Android app** ([its own project](decisions/0022-android-app.md)). Pairs by QR code and, for its members, shows their rooms as swipeable tabs of action tiles, runs actions, and shows what each switches and the devices of each room.
- **The coordinator ("the gateway").** A Zigbee radio on the home network, such as an SMLIGHT SLZB-06M. If it fails, one of the same kind can take its place.

## Main user journeys

**Setting up.** Connect the coordinator to the network. Install SynBee from Package Center, give it the coordinator's address, open it from the DSM menu, and set the admin password. See [installation](installation.md).

**Adding devices.** Open "Add devices" and put the device in pairing mode. It appears as a new device to name and put in a room.

**Coming from a Tuya gateway (optional).** Import the Tuya setup first; devices then join with their familiar names, and their scenes and automations wait as drafts. See [importing from Tuya](import-from-tuya.md).

**Building an automation.** For example: WHEN button 1 on a wireless switch is clicked, IF it is evening, THEN turn on the desk lamp. Press Test to try it, and later check the rule's history to see each time it ran, or why it was skipped.

**Using the app.** On the App users page, add a member and choose "Pair a phone". Scan the QR code in the app, at home or away. The member can use everything until the owner takes something away.

**Recovering from a failed coordinator.** Disconnect the old unit, connect a new one of the same kind, and run "Replace the gateway" on the Gateway page. The network is restored from the backup, and devices carry on without pairing again.

## Scope

Included:
- the DSM package, for Intel and AMD models (a 64-bit ARM package is built, untested on hardware);
- the hub with its web interface: devices, rooms, light groups, actions and automations;
- history, energy totals and notifications;
- gateways: several networks, backup, replacement and security hardening;
- the optional Tuya import;
- app users, and the Android app at home and away from home.

Not included (see the [specifications](../openspec/specs/) for what each would need):
- switching single devices from the app, alerts on the phone;
- a release check, guided updates, external converters and device firmware updates.
