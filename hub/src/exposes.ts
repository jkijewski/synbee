// Flattens Zigbee2MQTT `exposes` definitions into individual properties.

export interface ExposedProperty {
  property: string;
  name: string;
  type: string;
  readable: boolean;
  writable: boolean;
  values?: string[];
  valueOn?: unknown;
  valueOff?: unknown;
  valueToggle?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  endpoint?: string;
  /** Zigbee2MQTT's grouping: device settings ('config') or technical readings ('diagnostic'); none for main controls. */
  category?: 'config' | 'diagnostic';
  /** Smallest change the device accepts, such as 0.5 for a thermostat setpoint. */
  step?: number;
  /** Whether the hub can ask the device for its current value (Zigbee2MQTT's "get"). */
  gettable?: boolean;
}

const PUBLISHED = 1;
const SETTABLE = 2;
const GETTABLE = 4;

export function flattenExposes(exposes: unknown[] | undefined): ExposedProperty[] {
  const out: ExposedProperty[] = [];
  const walk = (items: unknown[], endpoint?: string) => {
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue;
      const e = raw as Record<string, unknown>;
      const ep = typeof e.endpoint === 'string' ? e.endpoint : endpoint;
      if (Array.isArray(e.features) && e.type !== 'composite') {
        walk(e.features, ep);
        continue;
      }
      if (typeof e.property !== 'string') continue;
      const access = typeof e.access === 'number' ? e.access : 0;
      out.push({
        property: e.property,
        name: typeof e.name === 'string' ? e.name : e.property,
        type: String(e.type),
        readable: (access & PUBLISHED) !== 0,
        writable: (access & SETTABLE) !== 0,
        ...(Array.isArray(e.values) ? { values: e.values.map(String) } : {}),
        ...('value_on' in e ? { valueOn: e.value_on } : {}),
        ...('value_off' in e ? { valueOff: e.value_off } : {}),
        ...('value_toggle' in e ? { valueToggle: e.value_toggle } : {}),
        ...(typeof e.value_min === 'number' ? { min: e.value_min } : {}),
        ...(typeof e.value_max === 'number' ? { max: e.value_max } : {}),
        ...(typeof e.unit === 'string' ? { unit: e.unit } : {}),
        ...(ep ? { endpoint: ep } : {}),
        ...(e.category === 'config' || e.category === 'diagnostic' ? { category: e.category } : {}),
        ...(typeof e.value_step === 'number' && e.value_step > 0 ? { step: e.value_step } : {}),
        ...((access & GETTABLE) !== 0 ? { gettable: true } : {}),
      });
    }
  };
  walk(exposes ?? []);
  return out;
}

/** Whether a value lies on the device's steps from `base`, allowing for floating-point error. */
export function onStep(value: number, step: number, base = 0): boolean {
  const n = (value - base) / step;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

// Returns an error message if the value can't be written to this property, otherwise null.
export function checkValue(prop: ExposedProperty, value: unknown): string | null {
  if (!prop.writable) return `${prop.property} can't be set`;
  switch (prop.type) {
    case 'binary': {
      const allowed = [prop.valueOn, prop.valueOff, prop.valueToggle].filter((v) => v !== undefined);
      return allowed.some((v) => v === value) ? null : `${prop.property} must be one of ${allowed.join(', ')}`;
    }
    case 'enum':
      return typeof value === 'string' && (prop.values ?? []).includes(value) ? null : `${prop.property} must be one of ${(prop.values ?? []).join(', ')}`;
    case 'numeric':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${prop.property} must be a number`;
      if (prop.min !== undefined && value < prop.min) return `${prop.property} must be at least ${prop.min}`;
      if (prop.max !== undefined && value > prop.max) return `${prop.property} must be at most ${prop.max}`;
      if (prop.step !== undefined && !onStep(value, prop.step, prop.min ?? 0)) return `${prop.property} goes in steps of ${prop.step}`;
      return null;
    default:
      return null;
  }
}
