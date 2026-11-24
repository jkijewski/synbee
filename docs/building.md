# Building and testing SynBee

## Development

Requirements: Node.js 22, npm, Python 3 with Pillow (for the icons), and `curl`.

```bash
cd hub
npm ci
npm run typecheck
npm test
```

Build once (`npm run build`), then run the hub against the Zigbee2MQTT simulator, with simulated lights and sensors:

```bash
SIM=1 SIM_LIGHTS=1 SIM_SENSORS=1 HUB_DATA=/tmp/synbee-dev node supervisor/supervisor.mjs
```

Then open `http://127.0.0.1:8090` and set a password. `npm run dev:web` serves the web UI with live reload.

Adding a kind of device property: see [adding a feature](adding-a-feature.md). The architecture rules are checked by `hub/test/architecture.test.ts`.

## Building the package

```bash
package/synbee-spk/build.sh 1.0.0-0001 x86_64
package/synbee-spk/build.sh 1.0.0-0001 armv8
```

The build:

1. downloads the pinned Node.js for the architecture and checks it against Node.js's checksums;
2. builds the hub and web UI from a clean output folder, installs production dependencies and the pinned Zigbee2MQTT, and keeps only the serial-port binary for the architecture;
3. writes `THIRD-PARTY-NOTICES.txt`, copies `LICENSE`, `DISCLAIMER.md` and the GPL sources from `third-party/sources`, and fails if a bundled GPL package has no source there;
4. draws the icons, generates and checks `INFO`, and writes `synbee-<version>-<arch>.spk` with a `.sha256` and a `.build` file (source commit, Node.js and Zigbee2MQTT versions) into `~/hub-builds`.

Package Center details (maintainer, distributor, website, support links) are in `package/synbee-spk/package-info.conf`.

## Testing a package

Test on a **Virtual DSM** kept off the LAN (for example the `vdsm/virtual-dsm` container bound to loopback), never pointed at a real coordinator. Before a release, check what Synology's review checks:

- install, start, stop, upgrade, and uninstall with data kept and with data deleted;
- no SynBee process left after uninstall, and the port definitions removed;
- offline installation, with no unexpected connections while installing;
- all three ports listed in DSM's port settings, without conflicts;
- a clean Security Advisor scan and Antivirus Essential scan;
- no error logs, AppArmor denials or core dumps.

Then test on a real NAS with a real coordinator, after downloading a coordinator backup.

## Updating Zigbee2MQTT

1. Change the version in `hub/zigbee2mqtt/package.json` and run `npm install` there to update the lockfile.
2. Replace the sources in `third-party/sources` with those of the new versions of every bundled GPL package, and update `SHA256SUMS` and the README there.
3. Run the tests, build, and test on Virtual DSM and a real network.

## Publishing

The release steps and everything Synology's Package Center submission asks for (description, change log, links, screenshots, manual, test scenarios) are in [Releasing SynBee](package-center.md).
