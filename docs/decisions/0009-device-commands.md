# 0009. How commands are sent and confirmed

## Context

Real devices differ from their descriptions. Some lights can't fade, Tuya "datapoint" devices (model `TS0601`) can't take colour or brightness as a group broadcast, devices now and then miss a message, and some lights store a colour sent while off without lighting up.

## Decision

- **A command is confirmed by the device's report,** within a timeout, with each feature's tolerance. A silent device counts as a failure.
- **One retry when a confirmation is missed,** only in a form that can't apply twice: a toggle is repeated as the value it was meant to reach, and relative changes ("brighter by 20 %") are never repeated.
- **Fades only where the device has one** (its definition offers the `transition` option). Otherwise the fade is dropped from the command, and editors don't offer it. Groups offer a fade only when every member has one. The default fade is 1 second.
- **Light groups are Zigbee groups,** switched by one broadcast. When a member is a Tuya datapoint device, each member gets the command itself, with only the settings it supports, and the error names the members that didn't confirm.
- **Group members** are added and removed on the group's card. Each change is a message to the device; one that is off or out of range is named in the error, and the others still change.
- **Commands fit how a device takes them.** A light whose colour is only hue and saturation (`color_hs`) gets a hex colour converted to hue and saturation. A Tuya datapoint light (Skydance WZ5) handles colour, white temperature and both brightnesses with one Zigbee2MQTT converter, which runs once per message, and it ignores a change between colour and white while it is off. It also ignores a colour or white temperature identical to the one it has stored, and then stays in its other mode. So it gets, each in a message of its own: "on" first (skipped when it is already on), then a slightly different colour or white temperature and then the wanted one, then colour and its brightness, or white temperature and the white channel's brightness (a brightness asked together with a white temperature means the white one).
- **Tuya datapoint lights are paced.** Zigbee2MQTT confirms their commands at once from its own cache, so confirmation can't tell when the light has applied a part. The parts go 600 ms apart (700 ms after "on"), and the lights of a group are switched together, each with its own paced messages, 100 ms apart.
- **Light settings switch the light on:** a colour, brightness, white brightness or white temperature without an on/off value also turns the light on.
- **Availability** counts only "online" and "offline", and survives a device's rename.

## Consequences

- A group of Tuya datapoint lights doesn't change in one radio message; its lights may change a fraction of a second apart.
- A command to a device that misses messages can take up to twice the confirmation time before it fails.
