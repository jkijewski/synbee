# app-users Specification

## Purpose

Defines the people who use SynBee from the mobile app ("members"), what each of them may see and run, and the phones paired to them. Members are managed only by the owner, in the web interface on the home network; the app itself never changes them.

How this is built and why: [0020](../../../docs/decisions/0020-app-members-and-pairing.md).

## Requirements

### Requirement: Members
The owner SHALL be able to add, rename and remove members in the web interface. A member SHALL have a name of 1 to 40 characters, unique without regard to case. Members SHALL have no password and no access to the web interface. There SHALL be no administrator role in the app.

#### Scenario: Adding a member
- **WHEN** the owner adds the member "Jacek"
- **THEN** "Jacek" is listed with no paired phones and access to everything

#### Scenario: Duplicate name
- **WHEN** the owner adds "jacek" while "Jacek" exists
- **THEN** it is refused with a message naming the existing member

### Requirement: Permissions per action and room
A member SHALL be allowed every action and every room by default, including actions and rooms created later. The owner SHALL be able to revoke, and later restore, single actions and single rooms for a member. A device SHALL be visible to a member when its main room is allowed; a device without a room SHALL be visible unless the owner revokes "devices without a room".

#### Scenario: Revoking a room
- **GIVEN** the member "Anna" with access to everything
- **WHEN** the owner revokes the room "Garage" for her
- **THEN** her app no longer lists the devices whose main room is "Garage", and every other room is unchanged

#### Scenario: New action
- **WHEN** the owner creates a new action after revoking one action for "Anna"
- **THEN** the new action is allowed for her

#### Scenario: Removed room or action
- **WHEN** a room or action that was revoked for a member is deleted
- **THEN** the revocation is deleted with it

### Requirement: Status tiles and pausing alerts per member
Every member SHALL see every status tile in the rooms they may see until the owner unticks them on the tile's device, sensor group or check page. The owner SHALL be able to allow single members to pause alerts from the app; no member may until allowed.

### Requirement: Access from the item's page
The owner SHALL be able to see and change which members may use an action on the action's page, and which may see a room on the room's page, with one checkbox per member. The App users page SHALL list each member's permissions grouped by room, with the room's colour and icon and the actions' icons; a room's own checkbox SHALL show or hide the room in the app.

#### Scenario: Taking an action away from one member
- **WHEN** the owner unticks "Anna" under "In the app, for" on the action "Garage door"
- **THEN** Anna's app no longer lists it, and the App users page shows it unticked under Anna

### Requirement: Paired phones
Each member SHALL have zero or more paired phones, listed with their name, when they were paired and when they were last used. The owner SHALL be able to revoke a phone; a revoked phone's next request SHALL be refused. Removing a member SHALL revoke all of the member's phones.

#### Scenario: Lost phone
- **WHEN** the owner revokes "Anna's Pixel"
- **THEN** the phone's next request is refused with 401 and the app asks to pair again, while Anna's other phones keep working

### Requirement: Away from home per phone
Each paired phone SHALL have a switch "Away from home", off when it is paired at home and on when it is paired away from home. Only phones with it on SHALL be served from outside the home network, while the hub-wide away-from-home use is on; every phone keeps working at home.

#### Scenario: A tablet that stays at home
- **GIVEN** away-from-home use is on, Jacek's phone is allowed away from home and the kitchen tablet is not
- **WHEN** both are used on mobile data
- **THEN** Jacek's phone works, and the tablet is told it may be used at home only

### Requirement: Pairing a phone
The owner SHALL be able to create a pairing code for one member. The hub SHALL show it as a QR code and as a short code to type, together with the hub's addresses and the fingerprint of its key. A pairing code SHALL be usable once, SHALL expire after 10 minutes, and SHALL be replaced by a newer code for the same member. Pairing SHALL be accepted at home and away from home, whether or not away-from-home use is on.

#### Scenario: Pairing by QR code
- **WHEN** the owner shows the pairing code for "Jacek" and his phone scans it within 10 minutes
- **THEN** the phone is paired to "Jacek" and listed under him

#### Scenario: Code used twice
- **WHEN** a second phone uses a pairing code that was already used, or has expired
- **THEN** pairing is refused and nothing is paired

#### Scenario: Pairing from outside
- **WHEN** a phone away from home pairs with a valid code
- **THEN** it is paired with "Away from home" on, and is served away from home once the hub-wide away-from-home use is on

### Requirement: No configuration from the app
Nothing a member or a phone can do SHALL change members, permissions, devices, rooms, actions, rules or settings.

#### Scenario: Stolen phone token
- **WHEN** someone uses a phone's token against the web interface's API
- **THEN** it is refused, as the web interface accepts only the owner's session
