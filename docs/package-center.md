# Releasing SynBee

How a release is made, and what Synology's Package Center submission asks for, ready to paste. English only for now.

## Two ways to publish

- **GitHub releases:** the x86_64 `.spk` with its `.sha256`, installed by hand in Package Center → Manual install. Needs nobody's approval; users update by installing the next file. DSM shows a warning that the package isn't from Synology, which the user accepts.
- **Synology's Package Center:** submitted through Synology's developer programme and reviewed by Synology; users then find, install and update SynBee in Package Center itself. Slower, and a package published as free must stay free.

Both use the same `.spk`. The package is not marked beta (`BETA="no"` in `package/synbee-spk/package-info.conf`).

## Making a release

1. Update [CHANGELOG.md](../CHANGELOG.md): the first section becomes the package's change log in Package Center.
2. Raise `version` in `hub/package.json` for a new release; the build number in the package version only goes up.
3. `cd hub && npm ci && npm test && npm run typecheck`, and check `openapi/app-api.json` is current (the tests do).
4. Build: `package/synbee-spk/build.sh X.Y.Z-NNNN x86_64` (for example `1.1.0-0081`). An armv8 build also works (`… armv8`), but it is untested on hardware, so it is not published.
5. Test as in [Building and testing](building.md#testing-a-package): Virtual DSM first (install, upgrade from the previous release, uninstall keeping and deleting data, Security Advisor), then a real NAS with a real coordinator after downloading a coordinator backup.
6. Tag the commit `vX.Y.Z` (for example `v1.1.0`) and publish the x86_64 `.spk`, `.sha256` and `.build` files.

## Package Center submission

| Field | Value |
| --- | --- |
| Package name | SynBee (`synbee`) |
| Version | from the build, e.g. 1.1.0-0081 |
| Category | Utilities (or Home automation if offered) |
| Architectures | x86_64 only. Submit only the x86_64 `.spk`; armv8 builds but is untested and not published |
| Minimum DSM | 7.2-64570 |
| Developer / maintainer | Jacek Kijewski |
| Website | https://github.com/jkijewski/synbee |
| Support email | jacek.kijewski.gdynia@gmail.com |
| Support URL | https://github.com/jkijewski/synbee/issues |
| Licence | MIT; bundles Zigbee2MQTT (GPL v3), Node.js (MIT) and others, listed in THIRD-PARTY-NOTICES.txt with sources in `third-party/sources` |
| Price | Free |

### Description

> SynBee turns your Synology NAS into a private Zigbee hub. Add Zigbee switches, lights, sensors and remotes, group them by room, and control them from DSM, with no vendor cloud and no internet needed.
>
> • Devices: everything Zigbee2MQTT supports, with controls built from each device's capabilities.
> • Rooms, light groups, one-tap actions, and WHEN / IF / THEN automations with history and notifications.
> • Several Zigbee gateways, each its own network, with encrypted backups and guided coordinator replacement.
> • Gateway hardening: SynBee checks and sets a SMLIGHT SLZB gateway's protections.
> • App users: family members pair the SynBee Android app by QR code; you choose what each may use.
>
> Requires a network Zigbee coordinator, such as an SMLIGHT SLZB-06M with EmberZNet firmware. Bundles Node.js, Zigbee2MQTT and an MQTT broker; runs as its own user, with its data in a shared folder you choose and its secrets in the package's private folder.

### Screenshots

From the development simulator (`SIM=1 SIM_LIGHTS=1 SIM_SENSORS=1`, see the README), so no real home's names appear: Devices, a room, Actions, an automation, Gateway, App users with a QR code. 1280 × 800 or larger.

### Short manual

Point to [docs/installation.md](installation.md): installing, first steps with the coordinator, rooms and actions, app users, updating and uninstalling.

### Test scenarios for Synology's reviewers

1. Install from the `.spk`: the wizard asks for a data shared folder and the two ports (web 8090, app 8443); finish and start.
2. Open SynBee from the DSM main menu: the web interface opens and asks to set the hub's admin password (at least 10 characters).
3. Without a coordinator: Gateway shows that it isn't connected and how to add one; the other pages work, empty.
4. Stop and start the package in Package Center; check that no SynBee process remains after stopping.
5. Upgrade from the previous version: devices, rooms, actions and settings stay; Status → Upgrades and safety copies lists the copy taken before migrating.
6. Uninstall keeping data (the default), reinstall: everything is back. Uninstall choosing "Delete data permanently" and typing DELETE: SynBee's data is removed; the shared folder itself is never deleted.
7. Security Advisor and Antivirus Essential: clean.
