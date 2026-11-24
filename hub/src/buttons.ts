// Translates the raw `action` values remotes report into the hub's press names.

export type PressType = 'single_click' | 'double_click' | 'long_press';

export interface ButtonPress {
  button: number;
  press: PressType;
}

const PRESS: Record<string, PressType> = {
  single: 'single_click',
  click: 'single_click',
  single_click: 'single_click',
  double: 'double_click',
  double_click: 'double_click',
  hold: 'long_press',
  long: 'long_press',
  long_press: 'long_press',
};

// Per-model mappings. Values for the Tuya 3-button remote (TS0043, the "Wireless Switch") are Zigbee2MQTT's
// documented values.
const numbered = (buttons: number, presses: Record<string, PressType>) =>
  Object.fromEntries(
    Array.from({ length: buttons }, (_, i) => Object.entries(presses).map(([raw, press]) => [`${i + 1}_${raw}`, { button: i + 1, press }] as const)).flat(),
  ) as Record<string, ButtonPress>;
const TUYA_PRESSES: Record<string, PressType> = { single: 'single_click', double: 'double_click', hold: 'long_press' };

const MODEL_OVERRIDES: Record<string, Record<string, ButtonPress>> = {
  TS0041: numbered(1, TUYA_PRESSES),
  TS0042: numbered(2, TUYA_PRESSES),
  TS0043: numbered(3, TUYA_PRESSES),
  TS0044: numbered(4, TUYA_PRESSES),
};

export interface ButtonEvent {
  /** The value Zigbee2MQTT reports. */
  raw: string;
  /** Set when the value maps to a button and press type; otherwise rules use the raw value. */
  button?: number;
  press?: PressType;
}

/** The button events a device can send, from its `action` values, for rule choices. */
export function buttonEvents(model: string | undefined, exposes: unknown[] | undefined): ButtonEvent[] {
  const action = (exposes ?? []).find((e) => e && typeof e === 'object' && (e as { property?: unknown }).property === 'action') as
    | { values?: unknown[] }
    | undefined;
  const values = Array.isArray(action?.values) ? action.values.filter((v): v is string => typeof v === 'string' && v !== '') : [];
  return values.map((raw) => ({ raw, ...(normalisePress(model, raw) ?? {}) }));
}

export function normalisePress(model: string | undefined, action: unknown): ButtonPress | null {
  if (typeof action !== 'string' || action === '') return null;
  const override = model ? MODEL_OVERRIDES[model]?.[action] : undefined;
  if (override) return override;
  const numbered = /^(?:button_)?(\d{1,2})_([a-z_]+)$/.exec(action);
  if (numbered) {
    const press = PRESS[numbered[2]!];
    return press ? { button: Number(numbered[1]), press } : null;
  }
  const press = PRESS[action];
  return press ? { button: 1, press } : null;
}
