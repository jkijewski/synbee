# Pitfalls and principles

What is worth knowing before switching a home over to SynBee, and before changing its code: the risks of moving a home, the quirks of real devices and of DSM that SynBee handles, and the principles that keep it working. Each quirk links to the decision that covers it.

## Transition risks

Moving a working home from a vendor hub to SynBee has risks of its own, whatever the software.

| Risk | Why it matters | How to reduce it |
| --- | --- | --- |
| **No way back to the vendor network** | A device removed from a vendor gateway with "wipe data" forgets that network for good. The vendor's network key can't be exported, so the old setup can't be rebuilt. | Move one device at a time, starting with one that is easy to reach and to reset by hand. Keep the old gateway running until every device works in SynBee. |
| **Devices that don't leave by themselves** | Some devices ignore the "leave" message and keep looking for the old network. Others don't search again until they're reset. | Know each device's own reset (a long button press, a power sequence) before removing it. Have the device within reach. |
| **Modes chosen while pairing** | Some LED controllers decide their mode (RGB, RGB+CCT, white only) when they join, from how the button was pressed. A device in the wrong mode is recognised as a different model. | Check the model shown after joining. If it's wrong, forget the device and pair it again in the right mode. |
| **Interviews that don't finish** | A battery device can fall asleep before Zigbee2MQTT has read its details, so it joins as "unrecognised". | Keep it awake (press a button) and use "Read its details again". |
| **Automations off while devices move** | Imported automations stay disabled drafts until all their devices have joined. A switch can't control its lights for a while. | Move a remote together with the devices it controls, and enable its rules straight away. |
| **One program per coordinator** | A network coordinator accepts one client. A second program connecting to it (another Zigbee2MQTT, a test system) disturbs the live network. | Point test systems at an unused address, never at the real coordinator. The install wizard leaves the address empty by default. |
| **Losing the NAS** | The Zigbee network's key and backup live on the NAS. Without them, every device must be paired again. | Download the encrypted coordinator backup after setup and after big changes, and keep it off the NAS. |
| **Radio channel** | Zigbee and 2.4 GHz Wi-Fi share the band. Changing the channel later may need every device paired again. | Choose the channel at the start (SynBee uses 25, above Wi-Fi channel 11). |
| **Features that don't carry over** | Vendor cloud features (weather, location triggers), history, and schedules stored inside devices are lost. | List them before starting, and rebuild the ones that matter as rules. |
| **No warranty** | SynBee comes without warranty ([DISCLAIMER](../DISCLAIMER.md)). | Don't rely on it for anything where a failure could endanger people, animals or property. |

## Quirks SynBee handles

Real devices and platforms differ from their descriptions. Each of these is handled in the code and covered by a test or a simulator case; keep it that way when changing the code nearby.

### Devices

- **Renaming clears availability.** When a device is renamed, Zigbee2MQTT clears the old name's retained availability topic with an empty message. Only "online" and "offline" count, and availability is kept by name until the device list catches up ([0009](decisions/0009-device-commands.md)).
- **Not every device can fade.** Tuya "datapoint" LED controllers (`TS0601`) have no `transition` option, and Zigbee2MQTT rejects a whole command that includes one. Fades are sent only to devices whose definition offers them ([0009](decisions/0009-device-commands.md)).
- **Not every device takes group broadcasts.** The same devices can't take colour or brightness as a Zigbee group broadcast, so groups with such members send the command to each member ([0009](decisions/0009-device-commands.md)).
- **Devices miss messages.** A command not confirmed in time is sent once more, only in a form that can't apply twice ([0009](decisions/0009-device-commands.md)).
- **Skydance controllers need parts one at a time.** Their converter reads colour only as hue and saturation; it handles colour, white and both brightnesses together and runs once per message; they ignore a change between colour and white while off, and a colour identical to the one stored; Zigbee2MQTT confirms their commands from its cache; and "brightness" in white mode isn't the white brightness. SynBee sends "on" first, then each part in its own paced message, one light at a time ([0009](decisions/0009-device-commands.md)). For a device whose confirmations come from a cache, watch the real device before trusting a change.
- **Some lights store a colour and stay dark.** Light settings switch the light on unless the step says otherwise ([0009](decisions/0009-device-commands.md)).
- **Contact sensors' "on" value is "open".** Zigbee2MQTT declares a contact sensor's "on" value as `false`, while `true` always means the magnet is near. Words for yes/no values belong to true and false, not to "on" ([0008](decisions/0008-device-capabilities-and-features.md)).
- **Interviews don't always finish.** A battery device can fall asleep first and join as unrecognised; "Read its details again" asks for a new interview ([0008](decisions/0008-device-capabilities-and-features.md)).
- **A device that is off can't change its groups.** Group members are changed one by one, and the error names those that didn't answer ([0009](decisions/0009-device-commands.md)).
- **A lost gateway is silent.** Without its coordinator, Zigbee2MQTT keeps restarting in the background. The header light, the attention list and a notification after two minutes show it, and the supervisor logs why a process exited ([0007](decisions/0007-gateway-backup-and-replacement.md), [0003](decisions/0003-supervisor-and-processes.md)).
- **Ember backups store the IEEE address reversed.** Coordinator addresses are compared in either byte order ([0007](decisions/0007-gateway-backup-and-replacement.md)).
- **The SLZB serves its page shell without a login.** Only its settings requests (`/api2`) ask for one, so the web page check probes those. Its Security page leaves out empty fields and boxes that are off ([0007](decisions/0007-gateway-backup-and-replacement.md)).

### Security

- **Encoded paths.** Fastify routes on the decoded path, so `/api/%64evices` reaches `/api/devices`. Access is decided by the matched route, never the raw URL ([0005](decisions/0005-home-network-only.md)).
- **DNS rebinding and same-site apps.** A web page can rebind its domain to the NAS address, and another app on the same NAS counts as the same site for cookies. Only home host names are accepted, and changes must come from SynBee's own page ([0005](decisions/0005-home-network-only.md)).
- **Shared folders are readable through File Station.** Every secret, and Zigbee2MQTT's whole data folder with the network key, lives in the package's private folder ([0006](decisions/0006-data-and-secrets.md)).
- **Defaults travel.** A default address in the install wizard would point at someone else's device on another network; the coordinator address is empty by default.

### DSM packaging

- **`./` in the archive** makes DSM refuse the SPK as an invalid file; the build archives without it ([0001](decisions/0001-native-dsm-package.md)).
- **A `LICENSE` at the SPK's root** becomes an extra agreement step; licences travel inside the payload ([0001](decisions/0001-native-dsm-package.md)).
- **The port definition is read before `postinst`,** so the package ships one with the default ports.
- **A rename doesn't cross btrfs subvolumes.** Files are copied, checked and then deleted ([0006](decisions/0006-data-and-secrets.md)).
- **Stale build output** would ship deleted sources; builds start from empty output folders.
- **No downgrade.** DSM refuses an older version over a newer one; going back is uninstalling with data kept, then installing the older package ([0016](decisions/0016-zigbee2mqtt-updates.md)).
- **Empty source archives.** A dependency's repository marks every file `export-ignore`, so GitHub's download archive is empty; its GPL source is packed from a checkout ([0019](decisions/0019-licensing.md)).

### Product design

- **Wired flows are not for everyone.** Casual users build automations faster from lists that read as sentences; rules are WHEN / IF / THEN cards with a history that says why ([0010](decisions/0010-rules.md)).
- **Rooms that switch things cause surprises.** If moving a device to another room changed what an automation does, tidying up would break things. Rooms only organise; light groups switch ([0012](decisions/0012-rooms.md)).

## Principles

1. **Real devices are the specification.** Device descriptions promise more than devices do. Every quirk met on hardware becomes a simulator case and a test ([0018](decisions/0018-test-levels.md)).
2. **A command is done when the device says so.** Confirming by the device's own report, with tolerance and one safe retry, turns "sometimes doesn't work" into a clear success or a named failure.
3. **Show the infrastructure.** A silent gateway outage looks like broken automations. The state of the radio belongs in front of the user.
4. **Decide access by what will run, not by what was asked.** Checks on raw URLs, host names and origins are easy to get subtly wrong. Test them with encoded and hostile inputs.
5. **Keep keys out of shared places from the start.** Moving secrets later needs migrations, and leaves copies in backups.
6. **Never ship your own environment.** Defaults, examples and test fixtures should be generic: no addresses, names or identifiers from one home.
7. **Package like the platform expects.** Follow Synology's review checklist (privilege, ports, INFO fields, clean uninstall) from the first build, not at publishing time.
8. **Move one thing at a time, with a way to undo it.** The safest transition keeps the old system running until each device has proven itself in the new one.
