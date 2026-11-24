# dsm-package Specification

## Purpose

Defines how the hub is installed and managed as a real DSM package, so that it behaves like any other Synology app and never puts the owner's Zigbee data at risk during upgrade or removal.

How this is built and why: [0001](../../../docs/decisions/0001-native-dsm-package.md), [0003](../../../docs/decisions/0003-supervisor-and-processes.md), [0006](../../../docs/decisions/0006-data-and-secrets.md), [0001](../../../docs/decisions/0001-native-dsm-package.md).

## Requirements

### Requirement: Installable SPK package
The hub SHALL be delivered as an `.spk` file that installs through Package Center on supported Synology models.

#### Scenario: Clean install
- **WHEN** the owner installs the package manually and completes the install wizard
- **THEN** the package runs and all its services start without any command-line step

### Requirement: Native application
The package SHALL run natively on DSM with all its runtime components included, and MUST NOT require Container Manager or any container engine.

#### Scenario: NAS without Container Manager
- **GIVEN** Container Manager isn't installed
- **WHEN** the package is installed and started
- **THEN** all services run normally

### Requirement: Declared platform support
The package SHALL declare the DSM versions and architectures it supports, and only those it has been built and tested for.

#### Scenario: Unsupported NAS
- **WHEN** the NAS doesn't meet a declared requirement
- **THEN** the install stops with a clear reason, and no partial setup remains

### Requirement: One package per architecture
The package SHALL be built as one SPK per architecture, `x86_64` for Intel and AMD models and `armv8` for 64-bit ARM models, each holding only its own binaries. An architecture's SPK SHALL NOT be given to others before it has been installed and run on a NAS of that architecture.

#### Scenario: ARM build
- **WHEN** the package is built for `armv8`
- **THEN** it holds the ARM64 Node.js and only the ARM64 serial port binding, and its INFO says `arch="armv8"`

### Requirement: Package Center review
The package SHALL meet Synology's publication review: the required INFO fields (`package`, `version`, `os_min_ver`, `description`, `arch`, `maintainer`) and no deprecated ones, a non-privileged user, clean install, start, stop, upgrade and uninstall, offline installation without unusual connections, every listening port registered without conflicts, no error logs, AppArmor denials or core dumps, and passing Security Advisor and Antivirus Essential. The build SHALL refuse to produce a package with a missing required field or a deprecated one.

#### Scenario: Deprecated field
- **WHEN** someone adds `thirdparty="yes"` to the INFO template
- **THEN** the build fails and names the field

#### Scenario: Loopback port
- **WHEN** the package is installed
- **THEN** DSM's port list shows the web, phone app and internal message ports, the last marked as never to be opened or forwarded

### Requirement: Install wizard
The install wizard SHALL ask for the data folder, the web interface port (default 8090), the phone app port (default 8443) and the coordinator address, and SHALL validate those values before use. The two ports SHALL differ, and both SHALL be above 1024 so that no root access is needed.

#### Scenario: Port already in use
- **WHEN** the owner enters a port that's already in use, or an invalid data folder
- **THEN** the problem is reported and the package isn't started with that value

#### Scenario: Coordinator address left empty
- **WHEN** the owner leaves the coordinator address empty
- **THEN** the install continues and the hub's first-run wizard asks for it

### Requirement: Ports registered with DSM
The package SHALL register its web port, its phone app port and its internal message port with DSM, none of them to be forwarded, so that they appear in DSM's firewall settings.

#### Scenario: DSM firewall enabled
- **GIVEN** the DSM firewall is enabled
- **WHEN** the owner views its rules after installing
- **THEN** the package's ports can be selected, and the setup guide says which to allow from where

### Requirement: DSM menu entry
The package SHALL add an icon to the DSM menu that opens the hub interface, visible to administrators only.

#### Scenario: Opening from DSM
- **WHEN** an administrator clicks the icon
- **THEN** the hub interface opens and still asks for hub sign-in if there is no session

### Requirement: Package Center lifecycle
Starting and stopping the package in Package Center SHALL start and stop all of its services, and they SHALL return after a NAS restart if the package was running.

#### Scenario: Stopping the package
- **WHEN** the owner stops the package
- **THEN** all its services stop and its ports no longer respond

#### Scenario: NAS restart
- **GIVEN** the package is running
- **WHEN** the NAS restarts
- **THEN** all services return without manual action

### Requirement: Upgrades keep data
Upgrading the package SHALL keep the hub data, the Zigbee network key and pairings.

#### Scenario: Installing a newer package
- **WHEN** a newer package version is installed over the old one
- **THEN** settings, automations, actions and paired devices remain, with no re-pairing

### Requirement: Uninstall keeps data by default
Uninstalling SHALL keep the data folder unless the owner makes a separate, explicit choice to delete it, after being told what would be lost.

#### Scenario: Normal uninstall
- **WHEN** the owner uninstalls with the default choices
- **THEN** the services are removed, the data folder remains, and the owner is told where it is

#### Scenario: Reinstall on kept data
- **WHEN** the package is reinstalled using that data folder
- **THEN** the hub resumes with its devices paired and no first-run wizard

#### Scenario: Deleting data
- **WHEN** the owner explicitly chooses to delete data
- **THEN** only the named package data folder is deleted, after a warning that the Zigbee network key is lost and every device must be re-paired

### Requirement: Crashed services recover
A service that stops unexpectedly SHALL be restarted automatically, and Package Center SHALL show the package as unhealthy if it can't recover. The supervisor log SHALL record why it stopped: the error lines of its last output, or its last lines when there are none.

#### Scenario: One service crashes
- **WHEN** a service process stops unexpectedly
- **THEN** it restarts without manual action, and the other services keep running
- **AND** the supervisor log shows its exit code and the reason it printed, such as a refused connection to the gateway

### Requirement: No secrets or root in the package
The package MUST NOT contain passwords, keys or tokens, and all its services SHALL run as its own unprivileged user.

#### Scenario: Inspecting the SPK
- **WHEN** the built SPK is unpacked and searched
- **THEN** it contains no credentials, and its privilege configuration runs as the package user

#### Scenario: Running processes
- **WHEN** the package's processes are listed on the NAS
- **THEN** none of them runs as root

### Requirement: No secrets in the shared folder
The package MUST NOT write any secret, or any file containing the Zigbee network key, to the shared data folder. The app listener's TLS key, the MQTT credentials and Zigbee2MQTT's whole data folder, including its configuration, coordinator backup and pre-update backups, SHALL live in the package's private folder.

#### Scenario: Browsing the share
- **WHEN** a DSM user with access to the shared folder browses it in File Station after setup, pairing and an update
- **THEN** no key, no Zigbee2MQTT configuration and no coordinator backup is found

### Requirement: Safety copies around upgrades
Before migrating a database that has data, the hub SHALL copy it next to itself (`hub.db.before-v<version>-<time>`), and the package SHALL copy each gateway's Zigbee2MQTT data into the private folder before every upgrade; the last 3 copies of each SHALL be kept. Migrations SHALL run in order, each all or nothing, and SHALL be logged. The Status page SHALL show the database version, the recent upgrades, the copies and how to go back to an older version.

#### Scenario: A wrong upgrade
- **WHEN** an upgrade leaves the hub misbehaving
- **THEN** the owner can stop SynBee, put `hub.db.before-v17-…` back as `hub.db`, and install the previous package, with every device, room, action and rule as before the upgrade

