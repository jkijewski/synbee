# 0010. Automations as WHEN / IF / THEN rules in the hub

## Context

Automations must be buildable by a person without programming, and must say what they did and why.

## Decision

- A rule has one or more events (WHEN), an optional group of conditions (IF) and an ordered list of steps (THEN), edited as one column of cards with choices from lists.
  - **WHEN:** device events from each device's capabilities (a button press, a state change, a value crossing a threshold), optionally "and stays so for N minutes"; a time on chosen weekdays; sunrise or sunset, up to 4 hours before or after; every N minutes; an action being run; or a named event sent by another rule. Times and sun events can move at random by up to ±60 minutes, by the same amount all day and differently each day, so a home looks lived in. Any one event starts the rule.
  - **IF:** device values (including "between" and "for at least N minutes"), a time window, weekdays, whether it is dark (sunset to sunrise), or a light group's status (off: all its lights off; partly: some on, some off; on: all on, from the lights' own reports), combined with "all of" or "any of", one level only.
  - **THEN:** set a device or light group, wait, start a timer, run an action, send an event, or notify. A timer sets a device or light group N minutes later; running the step again starts its countdown again (auto-off). Timers are stored and survive a restart; the device page shows them, with a way to cancel. Each step can have its own "only if", and can end the rule after it runs. A skipped step doesn't stop the run; a failed one does.
- **The engine runs inside the hub,** driven by device events, a minute scheduler and action runs. Rules are stored as JSON and validated against device capabilities when saved.
- **Run history:** each run records the event, time, outcome (completed, skipped, failed, stopped, ignored, interrupted), reason, each step's result and the device values behind a failed condition. Old runs are pruned.
- **Test** runs the steps now and records it as a test.
- **Durations survive restarts:** a timer is stored when a device enters the state, re-armed with the time left after a restart, and fires once per stay. "For at least" conditions are checked against stored history.
- **Sunrise and sunset** are computed on the hub from the home's location (set once on the Status page, approximate is enough), with NOAA's solar equations. No internet and no weather service are involved. Without a location, sun events don't run and "it is dark" is never true, and the rule shows a warning.
- **Safety limits:** a rule triggered again while running ignores the new event and records it. Event chains stop at a fixed depth. Waits are not kept across restarts and are recorded as interrupted.
- The editor is on the home listener only.

## Alternatives considered

- **Embedding Node-RED.** Powerful, but wired flows are hard for casual users to read, and it would add a third process and an authenticated proxy.
- **Free-form scripting.** Out of scope; rules stay explainable.

## Consequences

- A hub that is down when a timer falls due runs the rule when it starts again, if the state still holds.
