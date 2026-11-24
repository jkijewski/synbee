# Installing and running SynBee

The short reference for installing, updating and removing SynBee. For a step-by-step introduction with pictures, read the [user guide](user-guide.md).

> SynBee is provided "as is", without any warranty, and its authors accept no responsibility for it under any circumstances. See [DISCLAIMER](../DISCLAIMER.md).

## What you need

- A Synology NAS with **DSM 7.2 or later**. Packages are built for Intel and AMD models (`x86_64`) and 64-bit ARM models (`armv8`). The ARM package isn't tested on hardware.
- A **network Zigbee coordinator** with a fixed address on your LAN, for example an SMLIGHT SLZB-06M with EmberZNet firmware. Note its address and port (often `6638`) from its own web page, and make sure nothing else is connected to it.
- About 250 MB of disk space.

## Install

1. Download the package for your NAS (`synbee-<version>-x86_64.spk` or `-armv8.spk`).
2. In DSM, open **Package Center → Manual Install** and choose the file. DSM warns that the package isn't from Synology; agree to continue.
3. The install wizard asks for:
   - **Before you install:** read the disclaimer and tick the box.
   - **Where to keep data:** a shared folder (default `synbee`). It's created if it doesn't exist; SynBee uses a `synbee` folder inside it.
   - **Ports:** the web interface port (default 8090) and the phone app port (default 8443). A port already in use on the NAS is refused.
   - **Zigbee coordinator:** its address as `host:port`, or empty to set it later on the Gateway page.
4. When the install finishes, open **SynBee** from the DSM main menu, or go to `http://<NAS address>:8090`. Set the admin password (at least 10 characters).

Open SynBee by the NAS's IP address or its local name (`nas.local`, `nas`, …). If you use another name that points to the NAS, add it to the `HUB_ALLOWED_HOSTS` setting; otherwise SynBee refuses it, as a protection against malicious web pages.

## First steps

1. **Gateway:** check that the coordinator shows "connected". Then download a backup (Gateway → Backup → Download), choose a passphrase, and keep the file off the NAS. It is the only way to restore the Zigbee network if the NAS is lost.
2. **Import from Tuya** (optional): bring over the names, rooms and automations of devices from a Tuya gateway. See [importing from Tuya](import-from-tuya.md).
3. **Add devices:** open "Add devices", choose how long to wait, and put each device in pairing mode. Joined devices appear with their names; give new ones a name and a room.
4. **Rooms, light groups, actions and automations:** build them in their pages. Test each automation with its Test button.

## Firewall and router

- DSM's firewall lists SynBee's three ports. Allow the web port (8090) and the phone app port (8443) from the home network only. The internal message port (18830) listens on the NAS itself only and needs no rule.
- Forward nothing on the router for the web interface. To use the phone app away from home, forward only the app port (8443); see the [user guide](user-guide.md#using-the-app-away-from-home).

## Phone app

On the **App users** page, add a member for each person, then choose **Pair a phone** and scan the QR code in the SynBee app, at home or away. Each member can use every action and room until you take something away there. A lost phone is revoked on the same page.

## Updating

Download a coordinator backup first. Then install the newer package with **Manual Install**; data, the password and keys are kept, and SynBee saves a copy of its database and Zigbee data before changing them. DSM refuses an older version over a newer one. To go back, follow **Status → Upgrades and safety copies → Going back to an older version**.

## Forgotten password

Run the package's upgrade wizard (install the same or a newer package again) and choose **Reset the hub's admin password**. Devices, actions and automations are kept.

## Uninstalling

The uninstall wizard keeps your data by default, so a later install picks up where you left off. To delete it, choose **Delete data permanently** and type DELETE. The shared folder itself is never deleted.
