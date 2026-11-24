import type { ExposedProperty } from '../exposes.js';

// A device feature module (0008): everything the hub knows about one kind of device property, in one place.
// Modules are plain data and pure functions, shared by the hub and the web interface.

export type Operator = 'eq' | 'ne' | 'gt' | 'lt' | 'between';

/** A step that changes a value relative to the current one, sent as Zigbee2MQTT's *_step attribute. */
export interface RelativeChange {
  /** Zigbee2MQTT attribute, such as brightness_step. */
  key: string;
  /** Converts a change in display units (e.g. +20 %) to the attribute's raw value. */
  toRaw(delta: number, prop: ExposedProperty): number;
}

/** A Tuya data point this feature understands, for the Tuya import. */
export interface TuyaMapping {
  /** Tuya codes, or a pattern for numbered ones such as switch_1. */
  code: string | RegExp;
  /** Zigbee2MQTT values for the Tuya value, or null when it can't be translated. */
  translate(code: string, value: unknown, notes: string[]): Record<string, unknown> | null;
}

export interface FeatureModule {
  id: string;
  /** Short name shown to the owner. */
  label: string;
  /** Whether this module handles the property; the first matching module wins. */
  matches(prop: ExposedProperty): boolean;
  /** Display unit, e.g. %, K, °C. */
  unit?: string;
  /** Raw Zigbee2MQTT value to what the owner sees, and back. Identity when absent. */
  toDisplay?(raw: number, prop: ExposedProperty): number;
  fromDisplay?(display: number, prop: ExposedProperty): number;
  /** How far a reported value may be from the requested one and still confirm it (raw units). */
  tolerance?(prop: ExposedProperty): number;
  /** Relative changes ("brighter by 20 %"), when the device supports them. */
  relative?: RelativeChange;
  /** Whether changes can fade over a transition time. */
  fades?: boolean;
  /** Operators offered for conditions and triggers. */
  operators: Operator[];
  /** Read-only properties are shown, and usable in rules, but not set. */
  readOnly?: boolean;
  tuya?: TuyaMapping[];
  /** Words for a yes/no value, such as Open / Closed, instead of On / Off. `on` is for the device's "on" value. */
  words?: { on: string; off: string };
  /**
   * The words belong to true and false, not to Zigbee2MQTT's "on" and "off" values. Sensors need this: Zigbee2MQTT
   * declares a contact sensor's "on" value as false (open), while true always means the magnet is near (closed).
   */
  wordsForTrue?: boolean;
  /**
   * When a value needs someone's attention, and how urgently: an alarm (leak, smoke) or a warning (low battery,
   * tamper). Returns null when all is well.
   */
  attention?(value: unknown, prop: ExposedProperty): 'alarm' | 'warning' | null;
  /** A question to confirm before sending this value, such as unlocking a door; null when no confirmation is needed. */
  confirm?(value: unknown, prop: ExposedProperty): string | null;
}
