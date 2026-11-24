# status-and-alerts Specification

## Purpose

Defines how the home's state is shown at a glance and how alerts leave the hub: sensor groups, checks, status tiles in the app, alerts to Synology Chat, pausing alerts, and the units readings are shown in.

How this is built and why: [0024](../../../docs/decisions/0024-sensor-groups-and-checks.md), [0025](../../../docs/decisions/0025-alerts-through-synology-chat.md).

## Requirements

### Requirement: Sensor groups
The owner SHALL be able to create named sensor groups of 1 to 50 yes/no sensor readings (contacts, leaks, smoke, motion, locks), each with a room for its tile, whether it shows as a tile, and optional words for an active and an inactive sensor. A group's kind SHALL follow its readings (contact, leak, smoke, motion, lock), and mixed kinds SHALL read as on/off. A reading that isn't a yes/no reading SHALL be refused. Names SHALL be unique, ignoring case.

#### Scenario: Refusing a temperature
- **WHEN** the owner adds a thermometer's temperature to a sensor group
- **THEN** it is refused, saying that it isn't a yes/no reading

### Requirement: Sensor group state in words
A sensor group's state SHALL be none, some or all of its sensors active, or unknown when no sensor has reported. In words: one sensor SHALL read as its state alone ("Closed"); several SHALL read "All closed", "All 3 open", or "2 of 5 open: Kitchen, Hall", using the owner's words when set, else the kind's ("open" / "closed", "wet" / "dry", "motion" / "clear", "unlocked" / "locked", "on" / "off"). Sensors that don't report SHALL be counted and named ("· 1 not reporting"). An active state SHALL have its kind's level: a warning for open and unlocked, an alarm for a leak or smoke, info for motion.

#### Scenario: One window
- **GIVEN** the group "Windows" with only the balcony door, and the words "otwarte" / "zamknięte"
- **WHEN** the door opens
- **THEN** the group reads "Otwarte", with a warning level

### Requirement: Checks
The owner SHALL be able to create named checks: one to ten conditions combined with "all of" or "any of", using the same conditions as automations except other checks, with words and a level (fine, info, warning, alarm) for true and for false, a room for the tile and whether it shows. A check SHALL be evaluated when read; its explanation SHALL list what makes it true, or what is missing when it is false.

#### Scenario: Not ready to leave
- **GIVEN** the check "Ready to leave": all doors and windows closed and the door locked, false meaning "Not ready" (warning)
- **WHEN** the balcony door is open
- **THEN** the check reads "Not ready", with the explanation "Doors & windows: 1 of 3 open: Balcony"

#### Scenario: No checks inside checks
- **WHEN** the owner adds a check as a condition of another check
- **THEN** it is refused

### Requirement: Sensor groups and checks in automations and actions
Automations SHALL be able to start when a sensor group becomes none, some or all active, or when a check becomes true or false, optionally only after it has stayed so for 1 to 1440 minutes; it SHALL be started again only after the state changes. Automations' and actions' IF SHALL be able to test a sensor group's state and a check's value. An action whose IF doesn't hold SHALL answer "Not run: …" naming what wasn't true ("Not run: "Ready to leave" isn't true").

#### Scenario: Left open
- **GIVEN** an automation WHEN "Doors & windows" becomes "some open" and stays so for 5 minutes, THEN notify "{device}: {state} for {duration}"
- **WHEN** the balcony door opens and stays open for 5 minutes
- **THEN** the notification "Doors & windows: 1 of 3 open: Balcony for 5 min" is sent, and nothing is sent if it closes sooner

### Requirement: Status tiles
The app SHALL show read-only status tiles in each room, before its actions: devices the owner chose (showing their summary or one reading), sensor groups and checks that show as tiles, each with its state in words, a level for its colour, and an explanation shown when tapped. A tile with no room SHALL show under "Other". The owner SHALL choose, on the device's, sensor group's or check's page, which members see each tile; every member SHALL see it until the owner unticks them. A tile's explanation SHALL leave out devices in rooms the member can't see.

#### Scenario: A tile hidden from one member
- **WHEN** the owner unticks "Tom" under "In the app, for" on the check "Ready to leave"
- **THEN** Tom's app no longer shows that tile, and Anna's does

### Requirement: Device tiles
A device tile SHALL show a yes/no reading in the owner's words for its two states (or the reading's own words) with its kind's level when active; a number with its unit, temperatures in the owner's unit and coloured from blue (10 °C or less) through green (about 21 °C) to red (28 °C or more); CO₂ as a warning above 1000 ppm and an alarm above 1500 ppm; fine dust (PM2.5) as a warning above 35 and an alarm above 55; a battery below 15 % as a warning. A device that doesn't answer SHALL read "Not reporting", as a warning.

#### Scenario: Living room temperature
- **WHEN** the living room thermometer reports 18.5 °C and the owner chose Fahrenheit
- **THEN** its tile reads "65.3 °F", tinted towards blue

### Requirement: Temperature unit
The owner SHALL be able to show temperatures in Celsius or Fahrenheit. The choice SHALL apply to the app (tiles, room pages, action details) and to notification texts. Devices keep reporting Celsius, and conditions and steps keep using it.

### Requirement: Notification texts with placeholders
An automation's notification text SHALL fill in, when sent: {device} (the device or sensor group that started it), {state} (its state now, in words and the owner's unit), {duration} (its "stays so for"), {check} and {why} (the check that started it and its explanation), {rule} and {time}. Unknown placeholders SHALL stay as written.

### Requirement: Alerts to Synology Chat
The owner SHALL be able to send notifications at or above a chosen level (alarms only, warnings and alarms, or everything) to a Synology Chat channel, by pasting the channel's incoming webhook address. Only incoming webhook addresses SHALL be accepted. The address SHALL be kept owner-only in the package's private folder and shown without its token. A test message SHALL be available, and Chat's refusals SHALL be shown in words. SynBee's own inbox SHALL keep every notification as before.

#### Scenario: Balcony door left open
- **GIVEN** Synology Chat set to "warnings and alarms", and an automation that sends the warning "Balcony door is open for 5 minutes"
- **WHEN** the door stays open for 5 minutes
- **THEN** the message appears in the Chat channel and the Synology Chat app shows it on the owner's phone

### Requirement: Pausing alerts
The owner SHALL be able to allow a member to pause alerts. Such a member's app SHALL offer to pause alerts for an hour, eight hours or until 7:00, and to resume them. While paused, nothing SHALL be sent to Synology Chat, the inbox SHALL still record every notification, and the Notifications page SHALL show who paused and until when, with a way to resume. Members not allowed SHALL be refused.

#### Scenario: A quiet evening
- **GIVEN** Anna may pause alerts
- **WHEN** she pauses them until 7:00 and the balcony door is left open
- **THEN** no Chat message is sent, the inbox records the alert, and the Notifications page says "Alerts are paused by Anna (Pixel 8) until 07:00"
