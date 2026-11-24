import type { Checks } from './checks.js';
import type { Db } from './db.js';
import type { DeviceViews } from './device-views.js';
import { Devices } from './devices.js';
import type { RuleEngine } from './rule-engine.js';
import type { SensorGroups, SensorKind, TileLevel } from './sensor-groups.js';
import { ACTIVE_LEVEL, isActive, kindOf } from './sensor-groups.js';
import type { DeviceTiles } from './tiles.js';
import { inUnit, temperatureColor, temperatureUnit, type TemperatureUnit } from './units.js';

// Status tiles for the app (plan: checks and alerts): read-only tiles in a room, next to its actions, for the devices
// the owner picked, sensor groups and checks. Each says its state in words, has a level for its colour, and explains
// itself on a long press. The app API filters them by what each member may see.

export interface StatusTile {
  /** "device:<ieee>", "sensors:<id>", "check:<id>". */
  id: string;
  kind: 'device' | 'sensors' | 'check';
  /** The room whose page shows it; null for "Other". */
  room: number | null;
  name: string;
  icon: string;
  text: string;
  level: TileLevel;
  /** A colour hint for the tile, as #rrggbb (temperatures: blue to red). */
  color?: string;
  /** The explanation, line by line; `room` marks a line about one device (its main room), left out for members who can't see that room. */
  why: Array<{ text: string; room?: number | null }>;
}

const KIND_ICON: Record<SensorKind, string> = { contact: 'sensor_door', leak: 'water_damage', smoke: 'detector_smoke', motion: 'sensors', lock: 'lock', binary: 'sensors' };

export function statusTiles(deps: {
  db: Db;
  views?: DeviceViews;
  deviceTiles?: DeviceTiles;
  sensorGroups?: SensorGroups;
  checks?: Checks;
  engine?: Pick<RuleEngine, 'evaluateCheck'>;
  iconOf?: (ieee: string) => string;
}): StatusTile[] {
  const out: StatusTile[] = [];
  const devices = new Devices(deps.db);
  const roomOf = (ieee?: string) => (ieee ? { room: devices.get(ieee)?.roomId ?? null } : {});
  const unit = temperatureUnit(deps.db);
  for (const t of deps.deviceTiles?.list() ?? []) {
    const row = devices.get(t.ieee);
    if (!row || !deps.views) continue;
    const v = deps.views.device(t.ieee);
    const attention = v.readings.find((r) => r.attention === 'alarm') ? 'alarm' : v.readings.find((r) => r.attention === 'warning') ? 'warning' : null;
    const shown = t.property ? readingLook(deps.views, t.ieee, t.property, t.labels, unit) : null;
    out.push({
      id: `device:${t.ieee}`,
      kind: 'device',
      room: row.roomId,
      name: row.name,
      icon: deps.iconOf?.(t.ieee) ?? 'sensors',
      text: v.online === false ? 'Not reporting' : (shown?.text ?? (v.summary || 'No reading yet')),
      level: v.online === false ? 'warning' : (attention ?? shown?.level ?? 'fine'),
      ...(shown?.color && v.online !== false ? { color: shown.color } : {}),
      why: [...v.readings.map((r) => ({ text: `${r.label}: ${r.text}` })), ...(v.battery !== null ? [{ text: `Battery: ${v.battery} %` }] : []), ...(v.lastSeen ? [{ text: `Last heard: ${v.lastSeen}` }] : [])],
    });
  }
  for (const g of deps.sensorGroups?.list() ?? []) {
    if (!g.tile) continue;
    const s = deps.sensorGroups!.status(g.id)!;
    out.push({
      id: `sensors:${g.id}`,
      kind: 'sensors',
      room: g.roomId,
      name: g.name,
      icon: KIND_ICON[g.kind],
      text: s.text,
      level: s.level,
      why: [...s.active.map((a) => ({ text: a.name, ...roomOf(a.ieee) })), ...s.unknown.map((u) => ({ text: `${u.name}: not reporting`, ...roomOf(u.ieee) }))],
    });
  }
  for (const c of deps.checks?.list() ?? []) {
    if (!c.tile) continue;
    const now = deps.engine?.evaluateCheck(c.id);
    if (!now) continue;
    out.push({
      id: `check:${c.id}`,
      kind: 'check',
      room: c.roomId,
      name: c.name,
      icon: now.level === 'fine' ? 'task_alt' : 'report',
      text: now.text,
      level: now.level,
      why: now.why.map((w) => ({ text: w.text, ...roomOf(w.ieee) })),
    });
  }
  return out;
}

/**
 * One reading as a tile shows it. Yes/no readings: the owner's word for the state, or the reading's own, with the
 * level of its kind when active. Numbers: the value with its unit (temperatures in the owner's unit and coloured
 * blue to red); CO₂, particles and a low battery get a warning or alarm level.
 */
export function readingLook(
  views: DeviceViews,
  ieee: string,
  property: string,
  labels: { active: string; inactive: string },
  unit: TemperatureUnit,
): { text: string; level: TileLevel; color?: string } | null {
  const prop = views.propsOf(ieee).find((p) => p.property === property);
  const value = views.value(ieee, property);
  if (!prop || value === undefined || value === null) return null;
  const words = views.device(ieee).readings.find((r) => r.property === property)?.text ?? String(value);
  if (prop.type === 'binary') {
    const kind = kindOf(property);
    const active = isActive(kind, prop, value);
    const own = active ? labels.active : labels.inactive;
    return { text: own || words, level: active ? ACTIVE_LEVEL[kind] : 'fine' };
  }
  if (typeof value !== 'number') return { text: words, level: 'info' };
  if (/temperature/.test(property) || prop.unit === '°C') return { text: inUnit(words, unit), level: 'info', color: temperatureColor(value) };
  if (property === 'co2') return { text: words, level: value > 1500 ? 'alarm' : value > 1000 ? 'warning' : 'fine' };
  if (property === 'pm25') return { text: words, level: value > 55 ? 'alarm' : value > 35 ? 'warning' : 'fine' };
  if (property === 'battery') return { text: words, level: value < 15 ? 'warning' : 'fine' };
  if (property === 'humidity') return { text: words, level: value < 30 || value > 65 ? 'info' : 'fine' };
  return { text: words, level: 'info' };
}
