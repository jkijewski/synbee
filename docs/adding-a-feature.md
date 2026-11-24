# Adding a device feature

SynBee handles each kind of device property (on/off, brightness, white temperature, colour, temperature reading, …) with a **feature module** ([decision 0008](decisions/0008-device-capabilities-and-features.md)). A property no module claims still works through the generic modules (on/off, number, choice, read-only), so a new device never breaks anything; a module only makes it look and behave better.

## Where things live

| Part | File | Used by |
| --- | --- | --- |
| Module interface | `hub/src/features/types.ts` | everything |
| Registry, checks, confirmation, Tuya translation | `hub/src/features/index.ts` | hub and web |
| Hub modules | `hub/src/features/*.ts` | hub and web |
| Web controls | `hub/web/src/features/*.tsx`, listed in `hub/web/src/features/index.tsx` | web UI |
| Tests | `hub/test/features.test.ts` | |

The web UI imports the hub's modules directly, so a value is shown, checked and confirmed the same way everywhere.

## Example: a humidity reading

A read-only measurement is one line in `hub/src/features/sensors.ts` (humidity is already there; CO2 would look the same):

```ts
export const co2 = reading('co2', 'CO₂', 'co2', 'ppm');
```

Then add it to `FEATURES` in `hub/src/features/index.ts`, **before** the generic modules (the first match wins). That's all for the hub: the device page shows "CO₂ 640 ppm", and rules can use "is above", "is below" and "is between".

For a nicer look on the web, map its id to a control in `hub/web/src/features/index.tsx` (`co2: readingUI`); without that, read-only values already use the reading view.

## Example: a settable feature

A module for something you can set (say, a fan's speed in %) fills in more of `FeatureModule`:

- `matches(prop)`: recognise it from Zigbee2MQTT's `exposes` (`prop.property`, `prop.type`, `prop.min`/`max`, `prop.access`).
- `unit`, `toDisplay`, `fromDisplay`: how the raw value is shown (brightness: 0–254 shown as %).
- `tolerance(prop)`: how far a reported value may be from the requested one and still count as done.
- `relative`: the Zigbee2MQTT `*_step` attribute for "change by", and how display units turn into raw ones.
- `fades`: whether a fade time (`transition`) may go with it. The hub still sends one only to devices whose definition offers it ([0009](decisions/0009-device-commands.md)).
- `operators`: the comparisons offered in rules.
- `tuya`: Tuya data point codes and how to translate them, for the import.
- `words`: words for a yes/no value (`{ on: 'Closed', off: 'Open' }`), used on device pages and in rule choices ([0008](decisions/0008-device-capabilities-and-features.md)).
- `attention(value, prop)`: `'alarm'`, `'warning'` or null; the attention list on the Devices page uses it.
- `confirm(value, prop)`: a question to ask before sending a value (unlocking a door), or null.

A yes/no sensor is one line in `hub/src/features/binary-sensors.ts`:

```ts
export const frost = sensor('frost', 'Frost', 'frost', 'Frost', 'OK', 'warning');
```

Zigbee2MQTT's `config` and `diagnostic` features are put under Settings and Diagnostics automatically; a module needn't do anything for that.

Its web file exports a `FeatureUI` with three parts: `Control` (on the device page, sends a command), `Editor` (in actions, rules and conditions, edits a value without sending it) and `Display` (read-only).

## Tests

Add a case to `hub/test/features.test.ts` that checks, at least:

1. `featureFor` picks your module for a matching exposed property, and not for others;
2. display conversions both ways;
3. `checkValues` accepts good values and rejects bad ones with a clear message;
4. `confirms` within the tolerance;
5. the Tuya translation, if any.

Run `npm test` and `npm run typecheck` in `hub/`. To see it in the browser without hardware, run the simulator (`SIM=1`; `SIM_LIGHTS=1` adds three colour bulbs) and add your property to a sample device in `hub/src/sim/sample-devices.ts`.

## Rules of thumb

- Keep modules **pure**: no database, no network. They are shared with the browser.
- Never throw for an unknown property; fall through to the generic modules.
- Show values in the owner's units and store raw Zigbee2MQTT values.
