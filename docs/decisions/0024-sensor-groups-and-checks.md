# 0024. Sensor groups, checks and status tiles

## Context

People want to know at a glance whether the home is as it should be ("are the windows closed?"), to be told when it isn't, and to stop a scene from running when it makes no sense ("don't heat with the roof window open"). Single devices are too fine-grained for that, and what "OK" means differs between homes.

## Decision

- **Sensor groups** collect yes/no readings of one kind (contacts, leaks, smoke, motion, locks) and read as one state: none, some or all active. In words, one sensor reads as its state ("Closed"), several as "All closed", "All 3 open" or "2 of 5 open: Kitchen, Hall". The owner can give the two states their own words ("otwarte" / "zamknięte"); otherwise the kind's are used. A group's level when active comes from its kind: open and unlocked are warnings, leaks and smoke alarms, motion is information. Stored in `sensor_groups` and `sensor_group_members`, owned by `sensor-groups.ts`.
- **Checks** are the owner's named statements: one level of conditions ("all of" / "any of"), the same conditions as an automation's IF (device values, sensor groups, light groups, time, weekdays, dark or light), with the owner's words and level for true and for false. A check can't contain another check, so every check is explained in one step. The rule engine evaluates them (it already evaluates conditions), and explains a value by the conditions that made it. Stored in `checks`, owned by `checks.ts`; the condition types live in `conditions.ts` so actions and rules can share them without importing each other.
- **One vocabulary for everything.** Sensor groups and checks are conditions and events: automations start when they change (optionally "for N minutes", timed in memory and restarted from the current state after a restart), automations' and actions' IF test them, and notification texts can name them ({check}, {why}).
- **Actions are their own small automation:** WHEN tapped, IF (optional), THEN steps. Unmet conditions stop the action before any step, and the person who tapped is told what wasn't true ("Not run: "Ready to leave" isn't true"). The conditions are stored with the action (`actions.if_json`), not as a separate automation, so tiles, related items and imports work as before; other automations can still start on a tap.
- **Status tiles** in the app show devices the owner picks (`device_tiles`, with a reading and the owner's words for yes/no readings), sensor groups and checks, each with its words, a level and an optional colour, and an explanation. Numbers get meaning where it's common: temperatures coloured blue to red in the owner's unit, CO₂ and fine dust levels, a low battery. Every member sees every tile in their rooms until the owner unticks them (`member_hidden_tiles`), like actions; explanations leave out devices in rooms the member can't see.
- **Units:** temperatures are shown in Celsius or Fahrenheit, as the owner chooses (setting `units`). Devices, conditions and steps keep Celsius; only what is shown is converted.

## Alternatives considered

- **Checks inside checks, or expressions.** More powerful, but no longer explainable in one line; a second check or a sensor group covers the need.
- **Moving actions' steps into automations.** Cleaner on paper, but a data migration touching tiles, related items and imports, for the same behaviour.
- **Hysteresis settings on every number.** "For N minutes" on the event that reacts to a check covers flapping with one concept.

## Consequences

- A tile, an alert and a refused action all say the same words, because they read the same check.
- Sensor group and check events don't survive a restart mid-wait: after a restart the wait starts again from the current state.
