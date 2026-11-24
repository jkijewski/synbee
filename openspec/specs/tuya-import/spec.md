# tuya-import Specification

## Purpose

Lets an owner coming from a Tuya Zigbee gateway bring over device names, rooms, channel labels, groups, scenes and automations, so devices keep their familiar names when they join SynBee.

How this is built and why: [0017](../../../docs/decisions/0017-tuya-import.md).

## Requirements

### Requirement: Import from a Tuya configuration export
The hub SHALL import a read-only Tuya configuration export: rooms (reused, not duplicated, in Tuya's order), devices as waiting to join, channel labels of multi-channel switches, Zigbee groups as planned light groups, tap-to-run scenes as draft actions and automations as disabled draft rules. Whatever can't be translated, and device settings to set again by hand, SHALL be listed in an import report. Importing again SHALL update waiting devices and add nothing twice.

#### Scenario: Importing an export
- **WHEN** the owner imports an export with two rooms, three devices, one scene and one automation
- **THEN** the rooms and three waiting devices exist, the scene is a draft action and the automation a disabled draft rule, and the report lists anything not translated

#### Scenario: Importing again
- **WHEN** the same export is imported twice
- **THEN** no room, device, action or rule exists twice

### Requirement: Import from a tinytuya device listing
The hub SHALL also accept a tinytuya `devices.json` listing, importing device names and rooms, keyed by Zigbee IEEE address derived from each device's node ID.

#### Scenario: Importing a listing
- **WHEN** the owner imports a listing containing node ID `a4c1380000000001`
- **THEN** a pending device exists for address `0xa4c1380000000001` with the listing's name

#### Scenario: Listing entry without a node ID
- **WHEN** an entry has no node ID, such as the gateway itself
- **THEN** that entry is skipped and reported in the import result

### Requirement: Local keys are never stored
The hub MUST discard Tuya local keys, tokens, account and device IDs during import, and they MUST NOT appear in the database, logs or repository.

#### Scenario: Listing contains a local key
- **WHEN** a listing containing local keys has been imported
- **THEN** a search of the hub's database and logs finds no key value

### Requirement: Imported names apply on joining
A device joining with an imported address SHALL automatically receive its imported name.

#### Scenario: Re-paired device joins
- **GIVEN** a pending device for an address
- **WHEN** a device with that address joins the Zigbee network
- **THEN** the device appears under its imported name and is no longer pending

### Requirement: Drafts until devices have joined
Imported draft rules SHALL show when all their devices have joined, and the hub SHALL refuse to enable a rule whose devices haven't joined.

#### Scenario: Enabling too early
- **WHEN** the owner enables an imported rule whose remote hasn't joined yet
- **THEN** the hub refuses and names the device that is missing

### Requirement: Remote defaults for lights
When the Tuya import turns a button's single press into a rule that switches lights, it SHALL also add, as disabled drafts unless the button already has them, a double press that turns the lights off if on and to full brightness otherwise, and a long press that dims them by 20 % each press and goes back to full from the lowest step.

#### Scenario: Double press
- **GIVEN** the enabled double-press rule and the lights on
- **WHEN** the button is double-pressed
- **THEN** the lights turn off, and the full-brightness step does not run
