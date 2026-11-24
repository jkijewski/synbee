# Tuya configuration export

`export_config.py` reads a Tuya home's configuration from the Tuya cloud and writes it as one JSON file for SynBee's **Import from Tuya** page: rooms, devices with their Zigbee addresses, channel names, scenes, automations and Zigbee groups. It only reads. Local keys, tokens, account IDs, IP and MAC addresses and locations are stripped before the file is written, and SynBee stores none of them.

1. Create a Tuya IoT cloud project linked to your Tuya app account, and run `python3 -m tinytuya wizard` once; it writes `tinytuya.json` with the cloud credentials.
2. Find your Zigbee gateway's device ID (Tuya app → gateway → Device information, or `devices.json` from the wizard).
3. Run:

   ```bash
   python3 -m venv venv && venv/bin/pip install tinytuya
   venv/bin/python -I export_config.py --gateway <gateway id> --config tinytuya.json
   ```

4. Import the written `tuya-config-export-<date>.json` in SynBee, then delete it and `tinytuya.json`.

See [importing from Tuya](../../docs/import-from-tuya.md).
