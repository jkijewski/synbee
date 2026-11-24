# 0019. MIT licence, bundled GPL sources and no warranty

## Decision

- **SynBee is licensed under the MIT licence** (`LICENSE`), and is free.
- **Bundled third-party software keeps its own licences,** listed with their texts in the package's `THIRD-PARTY-NOTICES.txt`.
- **GPL components ship with their complete source.** Zigbee2MQTT, zigbee-on-host and Zigbee2MQTT's two web frontends are GPL-3.0. Their sources are kept in `third-party/sources`, with links to the exact upstream releases and checksums, and every package carries them in `third-party-sources/`. The build fails if a bundled GPL package has no source there.
- **No warranty and no liability.** SynBee is provided "as is", and its authors accept no responsibility under any circumstances ([DISCLAIMER](../../DISCLAIMER.md)). The disclaimer is in the repository, in the package, on the Status page, and in the install wizard's first step, which must be accepted before installing.

## Consequences

- Updating Zigbee2MQTT includes replacing the GPL sources with the new versions'.
