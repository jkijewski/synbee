# web-ui Specification

## Purpose

Cross-cutting rules for the hub's web interface: how items link to each other, what is shown as related, and how deletion warns.

How this is built and why: [0013](../../../docs/decisions/0013-related-items.md).

## Requirements

### Requirement: Linked names
Wherever the web interface names a device, action, automation, light group or room, the name SHALL be a link to that item's own page, including in room lists, light groups, "Add devices", action and automation lists and summaries, related lists and the import report. Each item's page SHALL open from its own address.

#### Scenario: From a light group to a bulb
- **WHEN** the owner clicks "salon regał" among the members of the light group "Living room lights"
- **THEN** the page of the device "salon regał" opens

### Requirement: Related items
The pages of a device, an action and an automation SHALL list the related devices, light groups, actions and automations, each linked. Indirect links SHALL be included and labelled with what they go through ("via light group X", "via action Y"). For automations, each link SHALL show its role: trigger, condition or target. Drafts and disabled automations SHALL be listed and marked. All of these lists SHALL come from one dependency index in the hub.

#### Scenario: Device used through an action
- **GIVEN** an automation where Wireless Switch button 1 runs the action "Desk spot", which toggles channel 1 of "biurko robocze"
- **WHEN** the owner opens "biurko robocze"
- **THEN** the action is listed as switching it, and the automation is listed as a target "via action Desk spot", marked as a draft if it is one

#### Scenario: Remote's automations
- **WHEN** the owner opens the Wireless Switch
- **THEN** its automations are listed with the role "trigger"

### Requirement: Delete warnings
Deleting a device, a light group or an action SHALL first show what uses it directly, from the same dependency index, and SHALL proceed only when the owner confirms. Forgetting a joined device SHALL ask it to leave the Zigbee network; forgetting one that hasn't joined SHALL only remove its entry.

#### Scenario: Deleting a used action
- **WHEN** the owner deletes the action "Desk spot", which an automation runs
- **THEN** the warning names that automation before anything is deleted

### Requirement: Actions and automations by room
The Actions and Automations lists SHALL be grouped by room like the device list, in the rooms' order. An action or automation SHALL appear under every room of the devices it uses, whether as trigger, condition or target, directly or through a light group or an action, and SHALL show those rooms as links when there is more than one. One that uses no device SHALL appear under "Not assigned". Actions and automations SHALL NOT be moved between rooms; their devices' rooms decide.

#### Scenario: Remote button rule
- **GIVEN** a rule where the Wireless Switch in "gabinet" runs an action switching "biurko robocze" in "gabinet"
- **THEN** the rule is listed under "gabinet"

#### Scenario: Device moves
- **WHEN** the owner moves "biurko robocze" to "salon"
- **THEN** the actions that switch it are listed under "salon" without being edited

### Requirement: A room's light groups, actions and automations
Each room on the Rooms page SHALL list, one per line and under separate headings with counts, the light groups, actions and automations that use its devices, as links from the dependency index, naming the room's devices each goes through and marking drafts and disabled automations.

### Requirement: Light groups by room
The Light groups list SHALL be grouped by the rooms of each group's devices, like actions and automations, with "Not assigned" for groups without devices, and SHALL NOT allow moving groups between rooms.

#### Scenario: Living room
- **GIVEN** draft actions "Living room red" and "Living room lights on" on the light group of the three living room bulbs
- **WHEN** the owner opens the Rooms page
- **THEN** "Living room" lists both actions, marked as drafts

### Requirement: Light groups named
Wherever an action or automation targets a light group, the group SHALL be shown by its name, as a link to that group.

### Requirement: Bootstrap look
The web interface SHALL use Bootstrap 5 components for its controls and layout: buttons (small, outlined for secondary actions), button groups and toolbars, badges, cards, form controls, navigation pills and tables, served from the hub with no internet access needed. Room colours and Material Symbols icons SHALL be kept. Buttons in one row SHALL be aligned and of the same height, buttons next to labelled fields SHALL line up with the fields, and badges SHALL keep a small gap from the name they follow. The interface SHALL follow the system's light or dark setting.

#### Scenario: Room card toolbar
- **WHEN** the owner opens the Rooms page at desktop or phone width
- **THEN** each room's buttons form one aligned row, wrapping cleanly on a phone

### Requirement: Step editors on a grid
Action and rule steps SHALL be laid out on the Bootstrap grid. Each step SHALL be a card whose first row holds its number, the device or light group (with a link to open it) and "Remove step". Each setting SHALL be one row with the setting, its value and a remove button in fixed columns, so that the settings, values and remove buttons of all rows line up, and SHALL stack on a phone.

#### Scenario: Two steps
- **WHEN** the owner edits an action with a group step (colour, brightness, fade) and a device step (on/off, white temperature)
- **THEN** all setting choices have the same width and start at the same place, and all remove buttons are in one column

### Requirement: Gateway light
The header SHALL show the gateway's connection as a light, as in the gateway spec.

