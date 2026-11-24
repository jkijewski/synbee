# 0008. Device capabilities from Zigbee2MQTT, handled by feature modules

## Context

Thousands of device types exist. SynBee must handle them without per-device code, and still show and use each property in a way a person understands.

## Decision

- **No device list of its own.** The hub reads each device's definition and capabilities (`exposes`) from Zigbee2MQTT and re-reads them whenever Zigbee2MQTT publishes a change. Controls, action steps and rule choices are built from them. Unrecognised devices are marked, with their raw details, and can be asked to report their details again (Zigbee2MQTT's interview).
- **One feature module per kind of property** (`hub/src/features/`). A module recognises its properties and owns:
  - how the raw value is shown (brightness 0–254 as %, white temperature as Kelvin, colour as a swatch);
  - the control, the read-only view, and the editor used in actions and rules;
  - step kinds (set, change by, toggle), comparisons (equal, above, below, between) and validation;
  - tolerance when confirming a command (a light reporting 127 after 128 is done);
  - words and severity for yes/no values (Open / Closed, Wet / Dry, alarm or warning), and questions to ask before risky values (unlocking a door);
  - the mapping from Tuya data points, for the import.
- **Generic modules come last** (on/off, number, choice, read-only), so an unknown property is never an error. The first matching module wins.
- **Zigbee2MQTT's categories are kept:** settings (`config`) and diagnostics (`diagnostic`) are shown in collapsible sections after the controls, and offered in editors only on request or when already used. Value steps from the device are enforced.
- **Remotes:** each model's raw button values are mapped to `single_click`, `double_click` and `long_press`. Rules use only those names. Remotes without a mapping offer their raw values.
- **Attention:** alarms (leak, smoke, carbon monoxide, gas), warnings (tamper, low battery, a lock not fully locked) and offline devices are listed at the top of the Devices page, alarms first.
- **Locks:** door locks show Locked / Unlocked. Unlocking from the device page asks first, and the API refuses an unlock without confirmation. Steps that unlock show a warning in their editors.
- **Refresh** asks a device for its current values where it allows that.

Adding a kind of property is one module, a registry entry and a test; see [adding a feature](../adding-a-feature.md).

## Alternatives considered

- **Per-device code.** Doesn't scale beyond a handful of devices.
- **Raw values everywhere.** 0–254 and mireds mean nothing to people.

## Consequences

- A device with an unusual property works, plainly, until a module is written for it.
