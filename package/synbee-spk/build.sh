#!/bin/bash
# Builds the SynBee SPK into ~/hub-builds. Usage: build.sh VERSION [ARCH]
#   VERSION  for example 1.0.0-0071
#   ARCH     x86_64 (default; Intel and AMD models such as the DS220+) or armv8 (64-bit ARM models)
# One SPK per arch, as Synology asks: each holds only its own Node.js and serial port binary.
set -euo pipefail

VERSION="${1:?usage: build.sh VERSION [x86_64|armv8]}"
ARCH="${2:-x86_64}"
case "$ARCH" in
    x86_64) NODE_ARCH="x64" ;;
    armv8) NODE_ARCH="arm64" ;;
    *) echo "Unknown arch: $ARCH (use x86_64 or armv8)" >&2; exit 1 ;;
esac
NODE_VERSION="v22.23.4"
PKG="synbee"
SRC="$(cd "$(dirname "$0")" && pwd)"
HUB="$(cd "$SRC/../../hub" && pwd)"
OUT="$HOME/hub-builds"
CACHE="$OUT/cache/node-$NODE_VERSION"
NODE_TAR="node-$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
mkdir -p -- "$OUT"
WORK="$(mktemp -d "$OUT/work.XXXXXX")"
trap 'rm -rf -- "$WORK"' EXIT

printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-[0-9]{4}$' || { echo "Bad version: $VERSION" >&2; exit 1; }

mkdir -p -- "$CACHE"
if [ ! -f "$CACHE/$NODE_TAR" ]; then
    curl -sfL -o "$CACHE/$NODE_TAR" "https://nodejs.org/dist/$NODE_VERSION/$NODE_TAR"
    curl -sfL -o "$CACHE/SHASUMS256.txt" "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt"
fi
(cd "$CACHE" && grep " $NODE_TAR\$" SHASUMS256.txt | sha256sum -c --quiet -)

payload="$WORK/payload"
spk="$WORK/spk"
mkdir -p -- "$payload/node/bin" "$payload/hub" "$spk"

# Node.js runtime
tar -xJf "$CACHE/$NODE_TAR" -C "$WORK" "node-$NODE_VERSION-linux-$NODE_ARCH/bin/node" "node-$NODE_VERSION-linux-$NODE_ARCH/LICENSE"
cp -- "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/bin/node" "$payload/node/bin/node"
cp -- "$WORK/node-$NODE_VERSION-linux-$NODE_ARCH/LICENSE" "$payload/node/LICENSE"

# Hub: build from a clean copy of the committed sources, then install production dependencies only.
git -C "$HUB" diff --quiet -- . || echo "Warning: hub/ has uncommitted changes; they are included in this build." >&2
# Start from empty output folders, so files of deleted sources never ship.
rm -rf -- "${HUB:?}/dist" "${HUB:?}/dist-web"
(cd "$HUB" && npm ci --no-audit --no-fund --loglevel=error && npm run -s build)
cp -a -- "$HUB/dist" "$HUB/dist-web" "$HUB/supervisor" "$HUB/package.json" "$HUB/package-lock.json" "$payload/hub/"
(cd "$payload/hub" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
# The web UI bundles the Material Symbols font (Apache 2.0); its licence travels with it.
mkdir -p -- "$payload/hub/dist-web/licenses"
cp -- "$HUB/node_modules/material-symbols/LICENSE" "$payload/hub/dist-web/licenses/material-symbols-LICENSE.txt"
# Zigbee2MQTT, pinned by its lockfile (0016). Only the Linux glibc build of the serial port binding for ARCH is kept:
# the coordinator is reached over TCP, but Zigbee2MQTT loads the binding at start.
mkdir -p -- "$payload/hub/zigbee2mqtt"
cp -- "$HUB/zigbee2mqtt/package.json" "$HUB/zigbee2mqtt/package-lock.json" "$payload/hub/zigbee2mqtt/"
(cd "$payload/hub/zigbee2mqtt" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error)
z2m_version=$(node -p 'require(process.argv[1]).version' "$payload/hub/zigbee2mqtt/node_modules/zigbee2mqtt/package.json")
prebuilds="$payload/hub/zigbee2mqtt/node_modules/@serialport/bindings-cpp/prebuilds"
find "$prebuilds" -mindepth 1 -maxdepth 1 ! -name "linux-$NODE_ARCH" -exec rm -rf {} +
rm -f -- "$prebuilds/linux-$NODE_ARCH/"*musl*
# Licences of everything bundled: the hub's and Zigbee2MQTT's packages, and what the web UI compiles in.
node "$SRC/notices.mjs" "$payload/THIRD-PARTY-NOTICES.txt" "$payload/hub/node_modules" "$payload/hub/zigbee2mqtt/node_modules" \
    --web "$HUB/node_modules" react react-dom qrcode material-symbols bootstrap uplot
# GPL components travel with their complete source (third-party/sources), and SynBee's own MIT licence with the code.
SOURCES="$SRC/../../third-party/sources"
(cd "$SOURCES" && sha256sum -c --quiet SHA256SUMS)
gpl=$(node -e '
const fs = require("fs"), path = require("path");
const found = new Set();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name.startsWith("@")) { walk(p); continue; }
    try {
      const j = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
      const l = typeof j.license === "string" ? j.license : "";
      // Dual licences offering MIT (slip) are used under MIT.
      if (/GPL/.test(l) && !/\bMIT\b/.test(l)) found.add(`${j.name.replace(/^@[^/]+\//, "")}-${j.version}`);
    } catch {}
    if (fs.existsSync(path.join(p, "node_modules"))) walk(path.join(p, "node_modules"));
  }
}
for (const d of process.argv.slice(1)) walk(d);
console.log([...found].sort().join("\n"));
' "$payload/hub/node_modules" "$payload/hub/zigbee2mqtt/node_modules")
mkdir -p -- "$payload/third-party-sources"
for name in $gpl; do
    [ -f "$SOURCES/$name.tar.gz" ] || { echo "No source for bundled GPL package $name in third-party/sources" >&2; exit 1; }
    cp -- "$SOURCES/$name.tar.gz" "$payload/third-party-sources/"
done
cp -- "$SOURCES/README.md" "$SOURCES/SHA256SUMS" "$payload/third-party-sources/"
cp -- "$SRC/../../LICENSE" "$payload/LICENSE"
cp -- "$SRC/../../DISCLAIMER.md" "$payload/DISCLAIMER.md"
# Command shims aren't used at runtime, and they are symlinks pointing outside their folder.
find "$payload/hub" -type d -path '*/node_modules/.bin' -prune -exec rm -rf {} +
if find "$payload" -type l | grep -q .; then echo "Unexpected symlinks in the bundle:" >&2; find "$payload" -type l >&2; exit 1; fi
native=$(find "$payload/hub" -name '*.node' ! -path "$prebuilds/linux-$NODE_ARCH/*")
if [ -n "$native" ]; then echo "Unexpected native module in the bundle:" >&2; echo "$native" >&2; exit 1; fi

# Package files
cp -a -- "$SRC/ui" "$payload/"
cp -- "$SRC/synbee.sc.template" "$payload/"
# DSM may read the port definition before postinst fills in the chosen ports, so ship one with the defaults.
sed -e "s/@INTERNAL@/8090/" -e "s/@APP@/8443/" "$SRC/synbee.sc.template" > "$payload/synbee.sc"
python3 -I "$SRC/make_icons.py" "$WORK/icons"
cp -a -- "$WORK/icons/ui/images" "$payload/ui/"
cp -a -- "$SRC/scripts" "$SRC/conf" "$SRC/WIZARD_UIFILES" "$spk/"
cp -- "$WORK/icons/PACKAGE_ICON.PNG" "$WORK/icons/PACKAGE_ICON_256.PNG" "$spk/"

chmod -R u=rwX,go=rX -- "$payload" "$spk"
chmod 0755 -- "$spk"/scripts/* "$payload/node/bin/node"

# File times are the source commit's time: reproducible, yet newer with every commit, so browsers don't keep
# showing cached copies of changed files (DSM serves the menu icons with their file time).
MTIME="@$(git -C "$HUB" log -1 --format=%ct)"
(cd "$payload" && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="$MTIME" -czf "$spk/package.tgz" *)
extractsize=$(du -sk --apparent-size "$payload" | cut -f1)

# Package Center details (maintainer, distributor, links) live in package-info.conf.
# shellcheck source=package-info.conf
. "$SRC/package-info.conf"
DESC_ENU="SynBee is a private Zigbee hub on your NAS: add Zigbee switches, lights, sensors and remotes, group them by room, run actions and WHEN / IF / THEN automations, all without a vendor cloud. Needs a network Zigbee coordinator such as the SMLIGHT SLZB-06M. Bundles Node.js, Zigbee2MQTT $z2m_version and an MQTT broker."
# English only for now (no translations): Package Center falls back to these in every language.
# The change log is the first section of CHANGELOG.md, its bullets joined into one line.
CHANGES=$(awk '/^## /{n++; next} n==1 && /^- /{sub(/^- /, ""); printf "%s%s", sep, $0; sep="; "}' "$SRC/../../CHANGELOG.md" | tr -d '"')
info_field() { [ -n "$2" ] && printf '%s="%s"\n' "$1" "$2"; return 0; }
{
    info_field package "$PKG"
    info_field version "$VERSION"
    info_field os_min_ver "7.2-64570"
    info_field arch "$ARCH"
    info_field displayname "SynBee"
    info_field displayname_enu "SynBee"
    info_field description "$DESC_ENU"
    info_field description_enu "$DESC_ENU"
    info_field changelog "$CHANGES"
    info_field maintainer "$MAINTAINER"
    info_field maintainer_url "$MAINTAINER_URL"
    info_field distributor "$DISTRIBUTOR"
    info_field distributor_url "$DISTRIBUTOR_URL"
    info_field support_url "$SUPPORT_URL"
    info_field helpurl "$HELP_URL"
    info_field beta "$BETA"
    info_field dsmuidir "ui"
    info_field dsmappname "$PKG"
    info_field install_dep_services "network-online.target"
    info_field start_dep_services "network-online.target"
    info_field extractsize "$extractsize"
    info_field checksum "$(md5sum "$spk/package.tgz" | cut -d' ' -f1)"
} > "$spk/INFO"
# Synology's review refuses deprecated INFO fields (thirdparty, startable, support_conf_folder).
if grep -Eq '^(thirdparty|startable|support_conf_folder|dsm_min_ver)=' "$spk/INFO"; then echo "Deprecated field in INFO" >&2; exit 1; fi
for f in package version os_min_ver description arch maintainer changelog support_url; do
    grep -q "^$f=" "$spk/INFO" || { echo "INFO lacks required field $f" >&2; exit 1; }
done
chmod 0644 -- "$spk/INFO" "$spk/package.tgz"

result="$OUT/$PKG-$VERSION-$ARCH.spk"
(cd "$spk" && tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="$MTIME" -cf "$result" INFO package.tgz scripts conf WIZARD_UIFILES PACKAGE_ICON.PNG PACKAGE_ICON_256.PNG)
{
    echo "source commit: $(git -C "$HUB" rev-parse HEAD)"
    echo "arch: $ARCH"
    echo "node: $NODE_VERSION linux-$NODE_ARCH"
    echo "zigbee2mqtt: $z2m_version"
} > "$result.build"
sha256sum "$result" | tee "$result.sha256"
