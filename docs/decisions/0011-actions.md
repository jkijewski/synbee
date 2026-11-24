# 0011. Actions: named one-tap commands

## Decision

- An action is a named list of steps with an icon (a Material Symbols icon, chosen from a picker), a description and an order. A step sets a device or a light group. Steps run in order; a failed step stops the rest and is named in the result.
- Actions run from the Actions page with one tap.
- Running an action is also an event rules can start on ([0010](0010-rules.md)), so one action can be the shared "scene" behind several triggers.
- **Only when:** an action can have conditions, the same as an automation's IF; unmet, nothing runs and the person who ran it is told what wasn't true ([0024](0024-sensor-groups-and-checks.md)).
- Actions imported from elsewhere start as drafts, which show their missing devices until they are checked and saved.

## Consequences

- A scene is defined once, in one place, whether a person or an automation runs it.
