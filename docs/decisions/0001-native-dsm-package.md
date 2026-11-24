# 0001. A native DSM package, ready for Package Center

## Context

SynBee runs on a Synology NAS that is always on. It must install, start, stop, upgrade and uninstall like any other DSM app, without Container Manager, and meet the rules of Synology's Package Center review.

## Decision

- **One native `.spk` per architecture:** `x86_64` (Intel and AMD models) and `armv8` (64-bit ARM models), built by `package/synbee-spk/build.sh VERSION ARCH`. Each holds only its own Node.js runtime and serial-port binary. DSM 7.2 or later (`os_min_ver="7.2-64570"`).
- **Everything is bundled:** Node.js 22, the hub, the supervisor, Zigbee2MQTT and the MQTT broker. No container engine and no other package is needed, and installation needs no internet connection.
- **No root:** `conf/privilege` runs the package as its own user (`run-as: package`). Both listening ports are above 1024. Privileged work, such as creating the shared folder or registering ports, is done by DSM's resource workers.
- **Install wizard:** a disclaimer to accept, the shared folder for data, the web port, the app port, and the coordinator address (empty by default). The upgrade wizard offers to reset the hub's admin password. Lifecycle scripts validate every value again, including ports already in use on the NAS.
- **Ports are registered** through DSM's port-config worker: the web port; the app port, the one that may be forwarded for the app away from home ([0021](0021-app-api.md)); and the internal message port, which listens on 127.0.0.1 only and is marked never to be opened or forwarded. They appear in DSM's firewall and port-forwarding screens.
- **DSM menu entry:** a URL entry for administrators that opens the hub's web interface. The hub's own sign-in still applies.
- **Uninstall keeps data by default.** Deleting needs a separate choice and typing DELETE. It removes the data folder and the private secrets, never the shared folder itself. Processes are always stopped and port definitions always removed.
- **INFO is generated and checked by the build:**
  - the required fields are always present, and deprecated fields are refused;
  - the name, description and change log are in English (the change log is the first section of `CHANGELOG.md`);
  - released versions are not marked beta;
  - maintainer, distributor, website, support and help links come from `package/synbee-spk/package-info.conf`.
- **Licences travel inside the payload,** with `THIRD-PARTY-NOTICES.txt` and the GPL sources ([0019](0019-licensing.md)). There is no `LICENSE` at the SPK's root, because Package Center would turn it into an extra agreement step; the wizard's disclaimer step takes its place.

## Alternatives considered

- **Docker / Container Manager.** Not available on every model, adds a second management surface, and can't be published in Package Center as a native app.
- **One package for all architectures.** Synology asks for one file per architecture, and it would double the download.
- **Synology's Node.js package.** It would tie SynBee to Synology's update timing and version choice.

## Consequences

- Each release is built twice. An architecture's package is given out only after it has run on a NAS of that architecture.
- Package Center shows its third-party notice on install, as for every package not published by Synology.
- An archive member starting with `./` makes DSM refuse the SPK as an invalid file, so the build archives without that prefix.
