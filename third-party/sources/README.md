# Source code of the GPL components bundled in SynBee

SynBee itself is MIT-licensed (see [LICENSE](../../LICENSE)). The package also bundles Zigbee2MQTT and some of its
dependencies, which are licensed under the GNU General Public License version 3. This folder holds their complete
source at the exact versions the package ships, unmodified, and every SynBee package carries the same files in
`third-party-sources/`. The full licence texts are in the package's `THIRD-PARTY-NOTICES.txt`.

| Component | Version | Licence | Upstream release | Commit | File |
| --- | --- | --- | --- | --- | --- |
| Zigbee2MQTT | 2.14.3 | GPL-3.0 | https://github.com/Koenkk/zigbee2mqtt/releases/tag/2.14.3 | tag 2.14.3 | `zigbee2mqtt-2.14.3.tar.gz` |
| zigbee-on-host | 0.3.2 | GPL-3.0-or-later | https://github.com/Nerivec/zigbee-on-host/releases/tag/v0.3.2 | tag v0.3.2 | `zigbee-on-host-0.3.2.tar.gz` |
| zigbee2mqtt-frontend | 0.9.21 | GPL-3.0 | https://github.com/nurikk/zigbee2mqtt-frontend/tree/0.9.21 | 4a21fb2780a3a26847ee96a98c49dc3f793c2998 | `zigbee2mqtt-frontend-0.9.21.tar.gz` |
| zigbee2mqtt-windfront | 2.15.1 | GPL-3.0-or-later | https://github.com/Nerivec/zigbee2mqtt-windfront/releases/tag/v2.15.1 | tag v2.15.1 | `zigbee2mqtt-windfront-2.15.1.tar.gz` |

How the files were made (2026-11-21):

- Zigbee2MQTT, zigbee-on-host and zigbee2mqtt-windfront: GitHub's source archive of the release tag.
- zigbee2mqtt-frontend: its repository marks every file `export-ignore`, so GitHub's archive is empty. The file is the
  tag's checkout without `.git`.

`SHA256SUMS` lists their checksums. The two web frontends are installed as Zigbee2MQTT's dependencies but not used:
SynBee runs Zigbee2MQTT with its frontend switched off.

`slip` (MIT or GPL-2.0) is used under MIT.

When Zigbee2MQTT is updated (decision 0014), replace these files with the new versions' sources; the package build
refuses to run if a bundled GPL package has no matching source file here.
