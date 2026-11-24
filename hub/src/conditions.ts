// The conditions of automations and actions (0010, 0011): device values, time, weekdays, dark or light, light groups.
// Types only, so actions and rules can both use them without importing each other.

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: Monday 1 … Sunday 7

export type Comparator = 'eq' | 'ne' | 'gt' | 'lt' | 'between';

export type Condition =
  /** With `forMinutes`, the value must also have held for at least that long (0014). */
  | { type: 'state'; device: string; property: string; op: Comparator; value: unknown; forMinutes?: number }
  | { type: 'time'; from: string; to: string }
  | { type: 'days'; days: Weekday[] }
  /** Dark is from sunset to sunrise at the home's location. */
  | { type: 'sun'; is: 'dark' | 'light' }
  /** A light group's lights: all off, some on and some off ("partly"), or all on. */
  | { type: 'group'; group: number; is: GroupStatus }
  /** A sensor group: none, some or all of its sensors active (open, wet, motion…). */
  | { type: 'sensors'; group: number; is: 'none' | 'some' | 'all' }
  /** A check, true or false (not inside another check). */
  | { type: 'check'; check: number; is: boolean };

export type GroupStatus = 'off' | 'partly' | 'on';
