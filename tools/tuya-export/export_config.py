"""Read-only export of a Tuya home's configuration, for SynBee's "Import from Tuya" page.

Only GET requests are made: nothing on the Tuya account or the devices is changed. Local keys, tokens, account IDs,
addresses and locations are stripped before anything is written.

Usage:
    python3 -I export_config.py --gateway GATEWAY_ID [--config tinytuya.json] [OUT.json]

GATEWAY_ID is the Tuya device ID of the Zigbee gateway (shown in the Tuya app under the gateway's device
information, or in tinytuya's devices.json). The Tuya cloud credentials are read from the tinytuya.json written
by `python3 -m tinytuya wizard`.
"""
import argparse
import json
import os
import time

import tinytuya

SECRET_FIELDS = {"local_key", "key", "uuid", "sn", "ip", "lat", "lon", "mac",
                 "access_token", "refresh_token", "uid", "owner_id_secret"}


def scrub(obj):
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items() if k not in SECRET_FIELDS}
    if isinstance(obj, list):
        return [scrub(v) for v in obj]
    return obj


def main():
    ap = argparse.ArgumentParser(description="Read-only export of a Tuya home for SynBee")
    ap.add_argument("--gateway", required=True, help="Tuya device ID of the Zigbee gateway")
    ap.add_argument("--config", default="tinytuya.json", help="tinytuya.json with the cloud credentials")
    ap.add_argument("out", nargs="?", default="tuya-config-export-%s.json" % time.strftime("%Y-%m-%d"))
    args = ap.parse_args()
    out_path = args.out
    with open(args.config) as f:
        cfg = json.load(f)
    c = tinytuya.Cloud(apiRegion=cfg["apiRegion"], apiKey=cfg["apiKey"],
                       apiSecret=cfg["apiSecret"], apiDeviceID=cfg.get("apiDeviceID"))

    result = {"exported_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "calls": {}}

    redact = []  # identifiers that may appear in URL paths but must not be written out

    def get(path, query=None):
        try:
            r = c.cloudrequest(path, action="GET", query=query)
        except Exception as e:  # keep going, record the failure
            r = {"success": False, "error": repr(e)}
        key = path
        for r_ in redact:
            key = key.replace(r_, "<redacted>")
        result["calls"][key + ("?" + "&".join("%s=%s" % kv for kv in (query or {}).items()) if query else "")] = scrub(r)
        return r if isinstance(r, dict) else {}

    gw_id = args.gateway
    dev = get("/v1.0/devices/%s" % gw_id).get("result") or {}
    home_id = dev.get("owner_id")
    uid = dev.get("uid")

    # Devices behind the gateway (names, node_id = IEEE, product, room if given)
    get("/v1.0/devices/%s/sub-devices" % gw_id)
    if uid:
        redact.append(uid)
        get("/v1.0/users/%s/homes" % uid)
    if home_id:
        get("/v1.0/homes/%s" % home_id)
        rooms = get("/v1.0/homes/%s/rooms" % home_id).get("result") or {}
        for room in (rooms.get("rooms") or []):
            get("/v1.0/homes/%s/rooms/%s/devices" % (home_id, room.get("room_id")))
        get("/v1.0/homes/%s/scenes" % home_id)          # tap-to-run
        get("/v1.0/homes/%s/automations" % home_id)     # automations (incl. local linkage)
        rules = get("/v2.0/cloud/scene/rule", {"space_id": home_id, "page_size": 100}).get("result") or {}
        for rule in (rules.get("list") or []):   # full conditions/actions per rule
            get("/v2.0/cloud/scene/rule/%s" % rule.get("id"))
        scenes = get("/v1.0/homes/%s/scenes" % home_id).get("result") or []
        groups = {a.get("entity_id") for sc in scenes for a in (sc.get("actions") or [])
                  if a.get("action_executor") == "deviceGroupDpIssue"}
        for g in sorted(x for x in groups if x):
            get("/v2.0/cloud/thing/group/%s" % g)
            get("/v2.0/cloud/thing/group/%s/devices" % g)
    # Per-device detail (names, icons, status) for each sub-device
    subs = (result["calls"].get("/v1.0/devices/%s/sub-devices" % gw_id) or {}).get("result") or []
    for s in subs if isinstance(subs, list) else []:
        get("/v1.0/devices/%s" % s.get("id"))

    with os.fdopen(os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "w") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    os.chmod(out_path, 0o600)
    ok = sum(1 for v in result["calls"].values() if isinstance(v, dict) and v.get("success"))
    print("wrote %s: %d of %d calls succeeded" % (out_path, ok, len(result["calls"])))
    for k, v in result["calls"].items():
        if not (isinstance(v, dict) and v.get("success")):
            print("FAILED", k, (v or {}).get("msg") or (v or {}).get("error"))


if __name__ == "__main__":
    main()
