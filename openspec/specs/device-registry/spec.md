# device-registry Specification

## Purpose

Keeps the hub's record of Zigbee devices: joining, names, rooms, capabilities, controls and readings.

How this is built and why: [0002](../../../docs/decisions/0002-zigbee2mqtt-and-network-coordinator.md), [0008](../../../docs/decisions/0008-device-capabilities-and-features.md), [0009](../../../docs/decisions/0009-device-commands.md), [0012](../../../docs/decisions/0012-rooms.md), [0014](../../../docs/decisions/0014-history-energy-notifications.md).

## Requirements

### Requirement: First use
The admin password SHALL be set in the web interface on first use. The coordinator address SHALL come from the install wizard or be set later on the Gateway page, typed in or found on the network.

#### Scenario: No coordinator address at install
- **WHEN** the owner leaves the coordinator address empty in the install wizard
- **THEN** SynBee starts without Zigbee2MQTT, and the Gateway page asks for the address

### Requirement: Zigbee network key stays private
The Zigbee network key SHALL be generated for the new network at first run and kept only in the package's private folder. It MUST NOT be shown in the hub UI, written to logs, or stored in the shared folder or the repository.

#### Scenario: Looking for the key
- **WHEN** the shared folder, the hub UI, the logs and the repository are searched for the network key after setup and pairing
- **THEN** it isn't found

### Requirement: Joining only on request
The hub SHALL only allow device joining when the owner explicitly starts it, and only for a limited time.

#### Scenario: Pairing window expires
- **WHEN** the owner opens a pairing window and the time limit passes
- **THEN** new devices can no longer join until another window is opened

### Requirement: New devices
A device that joins SHALL appear in the hub, and the owner SHALL be able to name it and assign it a room.

#### Scenario: Brand-new device joins
- **GIVEN** a pairing window is open
- **WHEN** a recognised device joins
- **THEN** it appears as a new device, ready to be named and assigned a room

### Requirement: Controls from device data
The hub SHALL build a device's controls, settings screen and action step options from the capabilities and options reported for it, with no per-device hub code.

#### Scenario: Recognised device of a new type
- **WHEN** a recognised device with capabilities the hub hasn't seen before joins
- **THEN** its writable capabilities can be controlled and used in action steps, and its readable ones are shown

#### Scenario: Device settings
- **WHEN** the owner opens the settings of a device that reports options such as power-on behaviour or switch type
- **THEN** those settings appear and can be changed

### Requirement: Unrecognised devices are visible
The hub SHALL show when a device has joined but is not recognised or was not fully identified.

#### Scenario: Device missing from the database
- **WHEN** a device joins and no definition matches it
- **THEN** the hub marks it as unrecognised, showing its raw reported information, including model and manufacturer

### Requirement: Definitions stay current
The hub SHALL re-read device definitions whenever Zigbee2MQTT publishes a change, including after an update.

#### Scenario: Definition changes after an update
- **WHEN** Zigbee2MQTT publishes new definitions in which a device has gained a capability
- **THEN** the hub shows the new capability without a hub restart

### Requirement: Device state and commands
The hub SHALL show each device's current state and send commands to it.

#### Scenario: Commanding a channel
- **WHEN** a command turns on channel 1 of a registered switch
- **THEN** the device switches and the hub shows the new state

#### Scenario: Device is unreachable
- **WHEN** a command targets a device that does not respond
- **THEN** the hub reports the command as failed

### Requirement: Rooms
The hub SHALL keep a list of rooms, each with a name, an icon and a place in the order, and SHALL let the owner add, rename, reorder and delete them. Rooms from a Tuya import SHALL be reused rather than duplicated.

#### Scenario: Imported rooms
- **WHEN** the owner imports a Tuya export with the rooms "gabinet" and "salon"
- **THEN** those two rooms exist once each, in Tuya's order, and importing again adds no rooms

#### Scenario: Duplicate name
- **WHEN** the owner adds or renames a room to a name another room has
- **THEN** the hub refuses it

### Requirement: One main room per device
Each device SHALL have at most one main room. The device list SHALL be grouped by main room in the rooms' order, with devices without a room in their own group, and the device page and "Add devices" SHALL offer a single choice of room.

#### Scenario: Choosing a room while adding devices
- **WHEN** a device joins and the owner picks "salon" next to it on the "Add devices" page
- **THEN** "salon" becomes its main room and the device list shows it under that room

### Requirement: Extra rooms
A device SHALL optionally be shown in rooms besides its main room. Those rooms SHALL list it as well, and the main room SHALL stay unchanged. Wherever a device that is in more than one room is listed, in the device list, on the Rooms page and in the device page's header, its rooms SHALL be shown next to it as links, the main room first and marked as main. A device in a single room SHALL show nothing extra.

#### Scenario: A light for two rooms
- **GIVEN** a hall light whose main room is "hall"
- **WHEN** the owner also shows it in "salon"
- **THEN** it is listed under "hall" and under "salon", and in both places shows the rooms "hall" (main) and "salon" as links

#### Scenario: Extra room becomes the main room
- **WHEN** the owner makes one of a device's extra rooms its main room
- **THEN** that room is no longer listed among its extra rooms

### Requirement: Deleting a room
Deleting a room SHALL move the devices whose main room it was to another room the owner chooses, or leave them without a room, and SHALL drop it from every device's extra rooms.

#### Scenario: Deleting with a move
- **WHEN** the owner deletes "gabinet" and chooses to move its devices to "salon"
- **THEN** those devices have "salon" as their main room

### Requirement: Rooms organise, groups switch
Rooms SHALL NOT be targets of actions or rules, and changing a device's rooms SHALL NOT change what any action or rule does. Editors SHALL group device choices by main room. The Rooms page SHALL offer to create a light group from the lights whose main room a room is.

#### Scenario: Light group from a room
- **GIVEN** three joined bulbs whose main room is "salon"
- **WHEN** the owner chooses to make a light group of the room's lights
- **THEN** a light group named "salon" with those three bulbs is created

### Requirement: Moving devices between rooms
Each device listed in a room SHALL have a menu to move it to another main room, existing or new, and to remove it from that room. Removing it from its main room SHALL leave it "Not assigned"; removing it from an extra room SHALL remove only that extra room. Devices that are not assigned SHALL be listed last, under "Not assigned", when there are any. Several devices SHALL be movable at once.

#### Scenario: Remove from the main room
- **WHEN** the owner removes "biurko robocze" from its main room "gabinet"
- **THEN** it is listed under "Not assigned", at the end of the device list and of the Rooms page

#### Scenario: Remove from an extra room
- **GIVEN** the Wireless Switch with main room "gabinet", also shown in "salon"
- **WHEN** the owner removes it from "salon"
- **THEN** its main room is still "gabinet"

#### Scenario: Moving several devices
- **WHEN** the owner selects the three bulbs and moves them to "salon"
- **THEN** all three have "salon" as their main room, and keep their extra rooms

### Requirement: Adding devices to a room
Next to "Move to room…", each device's menu and the selection of several devices SHALL offer "Add to room…", which adds a room without changing the main room; for a device without a main room, the added room SHALL become its main room. Each room on the Rooms page SHALL offer "Add devices…" to choose devices to add to it in the same way.

#### Scenario: Adding a remote to a second room
- **GIVEN** the Wireless Switch with main room "gabinet"
- **WHEN** the owner adds it to "salon"
- **THEN** its main room is still "gabinet", and it is also shown in "salon"

#### Scenario: Adding a device that has no room
- **WHEN** the owner adds a "Not assigned" device to "salon"
- **THEN** "salon" becomes its main room

### Requirement: Room colours
Each room SHALL have a soft colour, used as a tint and an edge on its sections and cards and on its chips, readable in light and dark mode. A room without a chosen colour SHALL get one picked automatically to differ in hue from the other rooms' colours. The owner SHALL be able to choose a palette colour or an own colour, and to go back to automatic.

#### Scenario: Two rooms
- **GIVEN** the rooms "gabinet" and "salon" without chosen colours
- **THEN** their sections have clearly different tints

### Requirement: Room photos
The owner SHALL be able to add, replace and remove a photo for each room. The photo SHALL be scaled before it is stored, to a square thumbnail and a phone-sized picture, with its rotation applied and all metadata, including location, removed; the original SHALL NOT be kept. The thumbnail SHALL be shown next to the room's name, and the larger picture SHALL open from it. Photos SHALL be served only to signed-in users.

#### Scenario: Photo from a phone
- **WHEN** the owner adds a 12 MB phone photo taken upright with location data
- **THEN** the hub stores a 192 px square thumbnail and a picture of at most 1080 px, both upright and without location data


### Requirement: Device features
Each device property SHALL be handled by a feature module chosen from Zigbee2MQTT's exposes, which decides how it is shown, controlled, edited in actions and rules, compared, validated, confirmed and imported from Tuya. A property no module claims SHALL be handled by a generic module for its type and SHALL NOT be an error. Adding a feature kind SHALL need only a new module, a registry entry and a test.

#### Scenario: Brightness in percent
- **WHEN** a bulb reports brightness 128 of 254
- **THEN** its page shows 50 % on a dark-to-bright slider, and setting 50 % sends 127 or 128

#### Scenario: Tolerance
- **WHEN** the hub asks for brightness 128 and the bulb reports 129
- **THEN** the command counts as done

#### Scenario: New reading
- **WHEN** a device exposes a numeric property no module claims
- **THEN** it is shown as a plain number and can still be used in rules

### Requirement: Light controls
Lights SHALL offer on/off, brightness in percent, white temperature in Kelvin on a warm-to-cold gradient slider, colour from a picker with favourites, a separate white channel's brightness in percent where the light has one, a fade time defaulting to 1 second, and "change by" steps (brighter, dimmer, warmer, colder), for single lights and for light groups. A colour, brightness, white brightness or white temperature without an on/off value SHALL also switch the light on.

#### Scenario: Dim a group
- **WHEN** an action has the step "Living room lights: brightness down by 20 %"
- **THEN** each light in the group gets 51 dimmer with a 1 second fade

#### Scenario: Colour on a light that is off
- **GIVEN** "salon półka" is off
- **WHEN** the owner chooses red for it
- **THEN** it turns on in red

### Requirement: Fades only where the device has one
A fade SHALL be sent only to devices whose Zigbee2MQTT definition offers it (the `transition` option), and dropped from commands to others instead of failing them. Action and rule editors SHALL offer a fade only for such devices, and for light groups only when every member has one.

#### Scenario: Tuya LED controller
- **WHEN** an action sets "salon regał", a Skydance WZ5, to 40 % brightness
- **THEN** the editor shows no fade, and the command is sent without one and succeeds

### Requirement: Light groups
The owner SHALL be able to add and remove a light group's members on its card. A member that doesn't answer SHALL be named in the error, and the other changes SHALL still be made. A group command SHALL be one Zigbee group message, except when a member is a Tuya datapoint device (`TS0601`): then each member SHALL get the command itself and confirm it, and the error SHALL name the members that didn't.

#### Scenario: Colour on the bedroom group
- **GIVEN** "Living room lights" with three WZ5 LED controllers
- **WHEN** the owner chooses blue for the group
- **THEN** all three turn blue, each confirmed

#### Scenario: Member out of reach
- **WHEN** the owner adds two lights to a group and one of them is powered off
- **THEN** the other is added, and the error names the one that is off

### Requirement: A missed command is sent once more
A command that isn't confirmed in time SHALL be sent once more, if that can't apply twice: a toggle SHALL be repeated as the value it was meant to reach, and relative changes SHALL NOT be repeated. If it still isn't confirmed, the command SHALL fail.

#### Scenario: Toggle missed
- **WHEN** "salon półka" misses a toggle from on to off
- **THEN** the hub sends "off" once more, and reports success when the light confirms it

### Requirement: Reading a device again
For a device that joined but wasn't recognised or not fully read, the device page SHALL offer to read its details again (Zigbee2MQTT's interview).

#### Scenario: Unrecognised after joining
- **WHEN** a device shows as unrecognised after joining, and the owner reads its details again while it's awake
- **THEN** it is recognised, with its controls

### Requirement: Availability after a rename
A device's online or offline state SHALL survive its rename, including the hub's own rename of a newly joined device.

#### Scenario: Joined and renamed
- **WHEN** a device joins and the hub renames it to "salon półka"
- **THEN** it shows as online, not offline

### Requirement: Settings and diagnostics
Device features that Zigbee2MQTT marks as settings (`config`) or diagnostics (`diagnostic`) SHALL be shown in separate collapsible sections after the device's controls, and SHALL be offered in rule and action editors only on request or when already used. Numeric values SHALL respect the device's minimum, maximum and step.

#### Scenario: Radiator valve
- **WHEN** the owner opens a radiator valve with a 0.5 °C setpoint, a child lock and a battery level
- **THEN** the setpoint is a control that steps by 0.5, the child lock is under Settings, and the battery under Diagnostics
- **AND** a setpoint of 21.3 is refused

### Requirement: Sensor words and attention
Yes/no sensors SHALL be shown with words of their meaning (Open / Closed, Motion / Clear, Wet / Dry, Smoke / Clear, Detected / Clear, Low / OK), in device pages and rule editors. Alarms (leak, smoke, carbon monoxide, gas), warnings (tamper, low battery, a lock not fully locked) and offline devices SHALL be listed in a "Needs attention" list on the Devices page, alarms first.

#### Scenario: Leak
- **WHEN** a water leak sensor reports a leak
- **THEN** the Devices page shows "Needs attention" with an alarm: "Water leak: Wet", linking to the sensor

### Requirement: Refresh
For devices whose features can be read on request, the device page SHALL offer Refresh, which asks the device for its current values and shows them, or says that the device didn't answer.

### Requirement: Lock safety
Door locks SHALL be shown as Locked / Unlocked. Unlocking from the device page SHALL ask for confirmation, and the command API SHALL refuse an unlock without it. Action and rule steps that unlock SHALL show a warning in their editors.

#### Scenario: Unlock
- **WHEN** the owner presses Unlocked on the front door lock
- **THEN** the hub asks "This unlocks the door. Unlock it?" and unlocks only on yes

### Requirement: Reading history
The hub SHALL keep numeric and yes/no readings raw for 7 days, as 5-minute averages for 90 days and as hourly averages for 2 years, configurable, with a cap on raw readings, and SHALL show them as graphs for 24 hours, 7 days, 30 days and a year.

### Requirement: Energy totals
For devices with an energy counter, the hub SHALL count kWh per day from the counter's increases, ignoring restarts, replaced devices and implausible jumps, and SHALL show today, this month and the last month per day, for each device and in total.

### Requirement: Notification inbox and alarms
The web interface SHALL show unread notifications on a bell, red when an alarm is unread, and list them with links to the device or rule. Leak, smoke, carbon monoxide and gas alarms SHALL notify when they start, unless the owner turns that off.
