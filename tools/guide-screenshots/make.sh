#!/bin/bash
# Regenerates the user guide's screenshots from a simulator hub with a sample home (no real devices or data).
# Needs Google Chrome or Chromium as `google-chrome`, Python 3 with Pillow, and the hub built (`cd hub && npm ci && npm run build`).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
head -c 12 /dev/urandom | base64 | tr -dc a-zA-Z0-9 > "$WORK/pw"
cd "$REPO/hub"
SIM=1 SIM_LIGHTS=1 SIM_SENSORS=1 HUB_DATA="$WORK/data" HUB_INTERNAL_PORT=18190 HUB_APP_PORT=18443 HUB_MQTT_PORT=18932 node supervisor/supervisor.mjs > "$WORK/hub.log" 2>&1 &
HUB=$!
trap 'kill $HUB 2>/dev/null; rm -rf "$WORK"' EXIT
sleep 8
node "$HERE/populate.mjs" http://127.0.0.1:18190 "$(cat "$WORK/pw")"
node "$HERE/shots.mjs" http://127.0.0.1:18190 "$WORK/pw" "$WORK/shots"
python3 - "$WORK/shots" "$REPO/docs/images/guide" <<'PY'
import glob, os, sys
from PIL import Image
src, dst = sys.argv[1:]
os.makedirs(dst, exist_ok=True)
for f in sorted(glob.glob(os.path.join(src, '*.png'))):
    im = Image.open(f).convert('RGB')
    im = im.resize((1600, int(im.height * 1600 / im.width)), Image.LANCZOS)
    im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(os.path.join(dst, os.path.basename(f)), optimize=True)
    print(os.path.basename(f))
PY
