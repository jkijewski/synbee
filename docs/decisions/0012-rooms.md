# 0012. Rooms: one main room per device, more as an option

## Decision

- **Each device has one main room, or none.** The device list is grouped by it, and editors group device choices by it. Devices without a room are listed last, as "Not assigned".
- **A device can also be shown in other rooms.** Where a device in several rooms is listed, its rooms are shown next to it as links, the main room first.
- **Moving and adding:** each device in a room has a menu to move it to another main room (existing or new), add it to another room, or remove it from that room. Several devices can be moved at once.
- **Rooms page:** add, rename, choose an icon, reorder and delete rooms. Deleting moves the room's devices to another room, or leaves them without one. Each room lists its devices, light groups, actions and automations, and can make a light group from its lights.
- **Colours:** each room has a soft colour, automatic (farthest in hue from the others) or chosen, used as a tint in lists and cards, readable in light and dark mode.
- **Photos:** the browser scales a room photo to a 192 px square thumbnail and a picture of at most 1080 px, applying its rotation and dropping all metadata, including location. The hub stores only those two files, after checking their format and size.
- **Rooms organise; they don't switch anything.** Actions and rules name devices and light groups, never rooms, so changing a device's room never changes what an automation does. Actions, automations and light groups are listed under the rooms of the devices they use, also through a sensor group or check, and under the room such a sensor group or check is shown in.

## Consequences

- Switching a whole room at once is done with a light group.
