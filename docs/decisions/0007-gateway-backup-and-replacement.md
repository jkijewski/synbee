# 0007. The gateway page, its backup and replacement

## Context

The owner thinks of the coordinator as "the gateway". If it fails, or the NAS is lost, the Zigbee network must come back without pairing every device again.

## Decision

- **A Gateway page** shows the coordinator and its network:
  - status, address, adapter, firmware, IEEE address, Zigbee2MQTT version;
  - channel, PAN ID and extended PAN ID, number of devices, last backup.

  The network key is never shown. The page links to the coordinator's own web page, where its firmware is updated; SynBee never updates coordinator firmware.
- **The gateway's connection is visible everywhere,** from Zigbee2MQTT's bridge state, which the broker sets offline when Zigbee2MQTT stops:
  - a light in the header (green or red, linking to the Gateway page);
  - "Zigbee gateway: not connected" first in the attention list;
  - an alarm notification after two minutes without it (a Zigbee2MQTT restart takes seconds), and another when it is back.

  Losing the hub's own broker connection counts as the gateway being gone.
- **Backup:** Zigbee2MQTT writes the coordinator backup into its private data folder. The page shows its age, and reminds the owner to keep a copy off the NAS.
- **Download:** after the admin password is entered again and a passphrase is chosen, the backup and Zigbee2MQTT's device database are downloaded as one file encrypted with AES-256-GCM, with a key derived from the passphrase by scrypt. The passphrase is never stored.
- **Restore:** a downloaded file and its passphrase can be restored. Only the known backup files are accepted. They are staged and put in place before Zigbee2MQTT next starts.
- **Replace the gateway:** a guided step. The old unit must stay disconnected, and the new one must be the same chip family. The step takes the new address, typed or found on the network over mDNS (announcements only, never a connection). Zigbee2MQTT restarts on it, and the page shows whether the network's coordinator address carried over, matching it in either byte order since Ember backups store it reversed. Devices that stop reporting can be configured again without pairing.
- **Harden gateway security.** A network coordinator obeys whoever connects to its port, and its own web page may have no password. SynBee checks, without logging in, whether the gateway's web page asks for a login, and warns when it doesn't. With the gateway's web login, which the owner enters once and SynBee keeps in the private folder (owner-only, never shown again), SynBee reads and sets the gateway's protections on SMLIGHT SLZB gateways through the gateway's own settings requests (HTTP Digest login):
  - only this NAS may use the radio port (the address the gateway sees the NAS connect from; if the radio can't be reached two minutes later, it is switched off again by itself, with a notification);
  - a password on the gateway's recovery Wi-Fi;
  - the gateway's own MQTT and Home Assistant features off;
  - optionally, the gateway's web page off while SynBee is connected, the strictest setting. The gateway then hides its settings from SynBee too; SynBee remembers that it set it, and explains how to change settings (stop SynBee, use the gateway's page, start SynBee).

  A page saves all its fields at once, so the others are sent back as they were, and SynBee refuses a save that would send back an empty password for a protection that is on. Settings of firmware builds SynBee wasn't tested with are changed only after the owner confirms. Without a login, the same steps are a checklist the owner ticks.
- **Settings:** adapter type and flow control; the channel under "Advanced", only after confirming that devices may need pairing again. A network map from Zigbee2MQTT's scan is drawn on request.

## Consequences

- Without a downloaded copy, losing the NAS loses the network.
- Replacement needs a coordinator of the same chip family.
