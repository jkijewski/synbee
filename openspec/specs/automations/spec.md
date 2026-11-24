# automations Specification

## Purpose

Lets the owner build automations as simple WHEN / IF / THEN rules in the hub's own editor, made of cards and dropdowns rather than wired nodes, with a history that explains what each rule did and why.

How this is built and why: [0010](../../../docs/decisions/0010-rules.md).

## Requirements

### Requirement: Rule structure
An automation SHALL be a rule with a name, an enabled flag, one or more events (WHEN), an optional condition group (IF) and an ordered list of steps (THEN). Any one of its events SHALL start the rule.

#### Scenario: Rule with two events
- **GIVEN** a rule started by button 1 `single_click` or by 22:30 every day
- **WHEN** either event happens
- **THEN** the rule runs once for that event

#### Scenario: Disabled rule
- **WHEN** an event of a disabled rule happens
- **THEN** the rule doesn't run, and its history records nothing

### Requirement: Device events
A rule SHALL be able to start on a device event chosen from what the device supports in Zigbee2MQTT: a button and press type, a state change, or a value crossing a set threshold. Button presses SHALL use the names `single_click`, `double_click` and `long_press`.

#### Scenario: Matching press
- **GIVEN** a rule for button 1 `single_click` on the Wireless Switch
- **WHEN** that press happens
- **THEN** the rule runs

#### Scenario: Different press
- **WHEN** button 1 receives `double_click`
- **THEN** that rule doesn't run

#### Scenario: Remote without a known mapping
- **WHEN** a remote's reported press values have no mapping to these names
- **THEN** the event choices offer the values the device reports

#### Scenario: State change
- **GIVEN** a rule for channel 1 of "biurko robocze" turning on
- **WHEN** the channel turns on
- **THEN** the rule runs, and it doesn't run when the channel turns off

### Requirement: Time events
A rule SHALL be able to start at a set time on chosen weekdays, or every N minutes, using the NAS's time zone.

#### Scenario: Daily time
- **GIVEN** a rule for 22:30 on weekdays
- **WHEN** it is 22:30 on a Tuesday
- **THEN** the rule runs, and on Saturday at 22:30 it doesn't

### Requirement: Action events
A rule SHALL be able to start when a chosen action runs, whether from the web interface or another rule.

#### Scenario: Action run from the web interface
- **GIVEN** a rule started by the action "Good night"
- **WHEN** the owner runs "Good night" on the Actions page
- **THEN** the rule runs after the action's own steps

### Requirement: Rule events
A step SHALL be able to send a named event, and a rule SHALL be able to start on a named event. A chain of rules started by sent events SHALL stop after a fixed number of hops, and the history SHALL record where it stopped.

#### Scenario: Chained rules
- **GIVEN** rule A sends "evening started" and rule B starts on "evening started"
- **WHEN** rule A runs
- **THEN** rule B runs

#### Scenario: Loop
- **GIVEN** two rules that send events starting each other
- **WHEN** one of them runs
- **THEN** the chain stops at the hop limit, and both histories show it was stopped

### Requirement: Conditions
The IF part SHALL hold zero or more conditions on device states, a time window, weekdays, dark or light, light groups, sensor groups or checks (see the [status and alerts spec](../status-and-alerts/spec.md)), combined with either "all of" or "any of", with no nesting. With no conditions, the rule always continues to its steps.

#### Scenario: Condition not met
- **GIVEN** a rule with the condition "biurko robocze is off"
- **WHEN** its event happens while the device is on
- **THEN** no steps run, and the history records the run as skipped, naming that condition

#### Scenario: Any of
- **GIVEN** a rule with "any of" two conditions
- **WHEN** only the second condition is met
- **THEN** the steps run

### Requirement: Steps
The THEN part SHALL be an ordered list of steps. A step SHALL set a device value, wait for a set time, run an action or send an event. Each step SHALL be able to have its own "only if" condition, and a step whose condition isn't met SHALL be skipped while later steps still run. A failed step SHALL stop the rest of the run.

#### Scenario: Step with its own condition
- **GIVEN** step 2 "turn off salon regał, only if it is on"
- **WHEN** the rule runs while it is off
- **THEN** step 2 is skipped, step 3 runs, and the history shows why step 2 was skipped

#### Scenario: Step fails
- **WHEN** a device step fails
- **THEN** later steps don't run, and the history names the failed step and the reason

### Requirement: Choices come from devices
The editor SHALL build event, condition and step choices from each device's capabilities, so the owner picks a device, a property and a value rather than typing them.

#### Scenario: Adding a step
- **WHEN** the owner adds a "set device" step and picks "biurko robocze"
- **THEN** the editor offers its channels and their on and off values

### Requirement: Card-list editor
The hub SHALL provide an "Automations" page listing rules, with an editor showing one rule as WHEN, IF and THEN cards in a single column, usable on a phone-width browser. It SHALL be available only on the internal listener behind hub sign-in.

#### Scenario: Signed out
- **WHEN** a request for rules or the editor arrives without a hub session, or from outside the home network
- **THEN** it is refused

### Requirement: Run history
Each rule SHALL keep a history of its recent runs, showing the event that started it, the time, and whether it completed, was skipped, failed or was stopped, with the reason and per-step results.

#### Scenario: Owner checks why nothing happened
- **WHEN** the owner opens a rule whose last run was skipped
- **THEN** the history shows which condition wasn't met and the device state at that moment

### Requirement: Test run
The editor SHALL offer a Test button that runs the rule's steps now, and shows the result as a history entry marked as a test. Conditions are checked and reported, but the owner can choose to run the steps anyway.

#### Scenario: Testing a rule
- **WHEN** the owner presses Test
- **THEN** the steps run and the result appears at once in the history, marked as a test

### Requirement: Re-trigger while running
If a rule's event happens while that rule is still running, for example during a wait step, the new event SHALL be ignored by default and recorded in the history as ignored.

#### Scenario: Second press during a wait
- **GIVEN** a rule with a 5-minute wait step
- **WHEN** its button is pressed again during the wait
- **THEN** no second run starts, and the history records the press as ignored

### Requirement: Rules persist and run unattended
Rules SHALL be stored in the hub's database, survive hub and NAS restarts, and run without anyone signed in. A wait in progress at a restart SHALL be abandoned and recorded as interrupted.

#### Scenario: NAS restart
- **WHEN** the NAS restarts
- **THEN** existing rules run again without manual action

### Requirement: Durations
A value or threshold event SHALL optionally require the device to stay so for 1 to 1,440 minutes before the rule starts, and a value condition SHALL optionally require the value to have held for at least that long. Waiting SHALL be cancelled when the state ends, SHALL survive a hub restart, and SHALL start the rule once per stay.

#### Scenario: Door left open
- **GIVEN** the rule "front door becomes Open and stays so for 5 minutes → notify"
- **WHEN** the door opens, the hub restarts after 2 minutes, and the door stays open
- **THEN** the rule runs 5 minutes after the door opened, once
- **AND** it doesn't run if the door closes within the 5 minutes

### Requirement: Notify step
A rule step SHALL send a notification with a level (info, warning, alarm) and a text, with placeholders filled in when sent, to the hub's inbox and to Synology Chat when it is set up (see the [status and alerts spec](../status-and-alerts/spec.md)). The same notification within 10 minutes SHALL be counted as a repeat, and at most 60 new notifications an hour SHALL be kept, except alarms.

### Requirement: Sunrise and sunset
A rule SHALL be able to start at sunrise or sunset at the home's location, up to 240 minutes before or after, on chosen weekdays, and a condition SHALL be able to check whether it is dark (sunset to sunrise). Sun times SHALL be computed on the hub, without an internet service. Without a home location, sun events SHALL NOT run, "it is dark" SHALL NOT be true, and the rule SHALL show a warning.

#### Scenario: Lights before sunset
- **GIVEN** the home location is set and a rule starts 30 minutes before sunset
- **WHEN** that minute comes
- **THEN** the rule runs, and its history names the event

### Requirement: Random offset
A time or sun event SHALL optionally move by up to ±60 minutes at random, by the same amount all day and differently on different days, and SHALL fire once a day.

#### Scenario: Lived-in look
- **GIVEN** a rule at 22:00 ±15 minutes
- **THEN** on each day it runs once, between 21:45 and 22:15

### Requirement: Timer steps
A step SHALL be able to start a timer that sets a device or a light group after 1 to 1440 minutes. Running the step again SHALL start the countdown again. Timers SHALL survive a hub restart, SHALL be listed on the device page and the rule list, and SHALL be cancellable without running.

#### Scenario: Auto-off
- **GIVEN** a rule that switches a light on and starts a 10-minute timer to switch it off
- **WHEN** the rule runs again after 6 minutes
- **THEN** the light switches off 10 minutes after the second run, not the first

### Requirement: Light group status
A condition SHALL be able to check a light group's status from its lights' reported on/off state: off when all its lights are off, partly when some are on and some off, on when all are on. Lights not heard from SHALL be left out, and a group with none heard from SHALL have no status.

#### Scenario: Toggle a group
- **GIVEN** a rule "single click: off if the bedroom group is on or partly on"
- **WHEN** one of the three bedroom lights is on
- **THEN** the group is partly on, and the rule switches the group off

