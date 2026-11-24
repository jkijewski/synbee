# device-support-updates Specification

## Purpose

Keeps device support current in a deliberate, reversible way: a pinned Zigbee2MQTT that changes only with a package version, coordinator backups, restore and replacement, and a documented way back.

How this is built and why: [0016](../../../docs/decisions/0016-zigbee2mqtt-updates.md), [0007](../../../docs/decisions/0007-gateway-backup-and-replacement.md).

## Requirements

### Requirement: Pinned radio stack version
The package SHALL pin an explicit Zigbee2MQTT version, and it MUST NOT follow a moving tag or update by itself.

#### Scenario: Restarting the stack
- **WHEN** the package is restarted with no upgrade installed
- **THEN** the same Zigbee2MQTT version runs as before

### Requirement: Coordinator backup is visible
The hub SHALL show on its status page whether a coordinator backup exists and when it was last written, and SHALL warn when it is missing or older than a set age. The hub MUST NOT display the backup's contents, because it holds the Zigbee network key, and SHALL remind the owner to keep a downloaded copy off the NAS, since the backup is kept outside the shared folder and DSM's backups of that folder don't include it.

#### Scenario: Backup is current
- **WHEN** the owner opens the status page and Zigbee2MQTT has written a coordinator backup recently
- **THEN** the page shows that a backup exists and its date, with no warning

#### Scenario: Backup is missing or stale
- **WHEN** there is no coordinator backup, or it is older than the set age
- **THEN** the status page shows a warning explaining that a replacement coordinator would need every device paired again

### Requirement: Coordinator backup download
The admin SHALL be able to download the coordinator backup together with Zigbee2MQTT's device database from the internal listener, as one archive encrypted with a passphrase the admin chooses at download and the hub doesn't store. The admin MUST re-enter the admin password first, and the hub SHALL warn that the archive contains the network key and is useless without the passphrase. The download MUST be refused from outside the home network, without an admin session and with a wrong password.

#### Scenario: Admin downloads the backup at home
- **WHEN** the signed-in admin requests the backup download on the internal listener and confirms the warning
- **THEN** the hub sends an encrypted archive containing the coordinator backup and the device database, which can't be opened without the passphrase

#### Scenario: Download attempted from outside
- **WHEN** the download is requested from outside the home network, without an admin session, or with a wrong admin password
- **THEN** the request is refused and no backup data is sent

### Requirement: Restore from a downloaded backup
The replace step, and the first-run setup of a fresh install, SHALL accept a downloaded backup archive with its passphrase and restore the network from it.

#### Scenario: NAS replaced
- **GIVEN** a fresh install on a new NAS, and a downloaded backup with its passphrase
- **WHEN** the admin uploads the archive and enters the passphrase during setup
- **THEN** Zigbee2MQTT starts with the restored network, and devices work without re-pairing

#### Scenario: Wrong passphrase
- **WHEN** the passphrase doesn't open the archive
- **THEN** nothing is restored, and the hub says the passphrase is wrong

### Requirement: Coordinator can be replaced without re-pairing
Replacing a failed coordinator with another of the same chip family SHALL be possible from the coordinator backup alone, with no device needing to be paired again. The hub SHALL offer a guided replace step on the internal listener, for the admin only, which warns that the old unit must stay disconnected for good and that the new unit must be the same chip family, takes the new unit's address, updates Zigbee2MQTT's settings and restarts it.

#### Scenario: Swapping a failed coordinator
- **WHEN** the owner disconnects the old coordinator for good, connects a new one of the same model at the same address and restarts the package
- **THEN** Zigbee2MQTT restores the network from the backup, and paired devices, including battery devices once they wake, work without re-pairing

#### Scenario: Guided replacement
- **WHEN** the admin runs the replace step and enters the new unit's address
- **THEN** the hub shows the warnings first, then confirms whether the network was restored from the backup and whether the old IEEE address was copied

#### Scenario: Device reporting after replacement
- **WHEN** a device stops reporting state after the replacement
- **THEN** the hub offers to configure its reporting again, without pairing it again

#### Scenario: No usable backup
- **WHEN** the replace step finds no coordinator backup
- **THEN** it stops and explains that every device would have to be paired again

### Requirement: Documented rollback
Rollback SHALL consist of returning to the previous package version and restoring the copies taken before the upgrade: the database copy and the Zigbee2MQTT data copy, or a downloaded coordinator backup.

#### Scenario: Update causes problems
- **WHEN** the owner follows the rollback steps
- **THEN** the previous version runs and devices work as before the update

### Requirement: Updates need no root
The hub MUST NOT be able to install software or update itself on the NAS, and every update SHALL be installed by the owner through Package Center.

#### Scenario: Reviewing the package
- **WHEN** the package's privileges are reviewed
- **THEN** all services run as the package user, with no root access

## Not built

Requirements for features that are not part of SynBee. If one is added, it SHALL meet these; until then nothing in SynBee makes such outbound requests or offers these functions.

### Proposed requirement: Available version check
The hub SHALL check daily for the latest Zigbee2MQTT release and show the current version, the available version and the release notes.

#### Scenario: Newer release exists
- **WHEN** a newer release is published
- **THEN** after the next check, the hub shows both versions and the notes, and nothing is updated

#### Scenario: Check can't complete
- **WHEN** the release check fails
- **THEN** the hub shows when it last succeeded, and devices are unaffected

### Proposed requirement: Release check can be disabled
The owner SHALL be able to disable the release check, and the hub SHALL then make no such outbound requests.

#### Scenario: Check disabled
- **WHEN** the check is disabled
- **THEN** the hub makes no requests for release information and shows the check as off

### Proposed requirement: Guided update with a backup first
The hub SHALL guide the owner through an update delivered as a newer package version, and SHALL take a backup of the Zigbee2MQTT data, kept outside the shared folder, before the guide continues.

#### Scenario: Backup succeeds
- **WHEN** the owner starts the update guide
- **THEN** a backup containing the device database, coordinator backup and configuration is created, followed by the steps to install the newer package

#### Scenario: Backup fails
- **WHEN** the backup can't be created
- **THEN** the guide stops and doesn't show the update steps

#### Scenario: Update completes
- **WHEN** Zigbee2MQTT returns on the new version
- **THEN** the hub shows the new version and paired devices keep working without re-pairing

### Proposed requirement: External converters
From the internal interface, the owner SHALL be able to upload, list and remove external converter files and restart Zigbee2MQTT, with the files stored on the NAS in Zigbee2MQTT's private data folder.

#### Scenario: Adding a converter
- **WHEN** the owner uploads a converter and restarts Zigbee2MQTT
- **THEN** it is listed, and a matching device is recognised

#### Scenario: Removing a converter
- **WHEN** the owner removes a converter and restarts Zigbee2MQTT
- **THEN** it's no longer listed and its device goes back to being unrecognised, unless a release now supports it

#### Scenario: Attempt from outside the LAN
- **WHEN** a converter path is requested from an address outside the home network
- **THEN** the request is refused

### Proposed requirement: Firmware availability is read-only
The hub SHALL show which devices have a firmware update available, and it MUST NOT start firmware updates.

#### Scenario: Update available
- **WHEN** Zigbee2MQTT reports a firmware update for a device
- **THEN** the hub shows "update available" for that device, and offers no action to install it
