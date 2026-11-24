# Importing from a Tuya gateway

If your Zigbee devices are on a Tuya gateway, SynBee can bring over their names, rooms, groups, scenes and automations. Devices then join SynBee one at a time, and each gets its familiar name as it joins. Background: [0017](decisions/0017-tuya-import.md). Before you start, read the [transition risks](pitfalls.md#transition-risks).

## 1. Export and import your Tuya setup

Export your Tuya home's configuration with [`tools/tuya-export`](../tools/tuya-export/README.md); it only reads, and writes no keys or tokens. Import the file on SynBee's **Import from Tuya** page. A tinytuya `devices.json` listing also works, for names only.

| From Tuya | In SynBee |
| --- | --- |
| Rooms | Rooms, in Tuya's order |
| Devices | Devices waiting to join, matched by their Zigbee address |
| Channel names of multi-channel switches | Channel labels |
| Zigbee groups | Planned light groups, created when their lights have joined |
| Tap-to-run scenes | Draft actions |
| Automations | Disabled draft rules |
| Device settings (power-on behaviour, switch type) | A list to set again by hand |

Anything that couldn't be translated is listed in the import report. Importing again updates waiting devices and adds nothing twice.

## 2. Let devices join, one at a time

1. Open **Add devices** and choose a wait of up to 30 minutes.
2. In the Tuya app, remove the device with **Remove device → Disconnect and wipe data**. Many devices then look for a new network and join SynBee by themselves.
3. If a device doesn't join, put it in pairing mode by hand. This is usually done by holding its button for 5–10 seconds until its light blinks fast, or, for bulbs, by switching them off and on 3–5 times.
4. Test it from its page. If it shows as "unrecognised", press **Read device details again** while it is awake.

## 3. Turn on the automations

Draft rules show "ready to enable" once all their devices have joined. Check each one, press Test, and enable it. Draft actions become normal actions when saved.
