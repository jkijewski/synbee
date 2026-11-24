import type { Db } from './db.js';
import { Rooms } from './rooms.js';
import { Devices } from './devices.js';
import { Actions, type Step } from './actions.js';
import { LightGroups } from './groups.js';
import { Rules, type RuleStep, type Trigger } from './rules.js';
import { Settings } from './settings.js';
import { ieeeFromNodeId, importTuyaListing, type ImportResult } from './tuya-import.js';
import type { PressType } from './buttons.js';
import { tuyaIcon } from './device-icons.js';
import { translateTuya } from './features/index.js';

// Imports the read-only Tuya configuration export (tools/tuya-export/export_config.py): rooms, device names,
// channel labels, the Zigbee group, tap-to-run scenes as draft actions and automations as disabled draft rules
// (docs/import-from-tuya.md). Only names and translated steps are stored: no Tuya IDs, account details or keys.

export interface ExportImportResult extends ImportResult {
  rooms: string[];
  groups: Array<{ name: string; note: string }>;
  labels: Array<{ device: string; endpoint: string; label: string }>;
  actions: Array<{ name: string; notes: string }>;
  rules: Array<{ name: string; notes: string }>;
  notImported: Array<{ name: string; reason: string }>;
  /** Device settings to re-apply by hand after the device has joined. */
  settings: Array<{ device: string; setting: string; value: string }>;
}

export const IMPORT_REPORT_KEY = 'tuya-import-report';

/** Tuya categories for dimmable lights: bulbs, strips, ceiling lights, dimmers. */
const LIGHT_CATEGORIES = new Set(['dj', 'dd', 'xdd', 'fwd', 'dc', 'tgq', 'tgkg']);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 100) : '');

export function isTuyaExport(body: unknown): body is { calls: Json } {
  return isObj(body) && isObj(body.calls);
}

interface TuyaDevice {
  id: string;
  name: string;
  ieee: string | null;
  category: string;
  productId: string;
  status: Map<string, unknown>;
}

interface TuyaRule {
  name: string;
  type: 'scene' | 'automation';
  enabled: boolean;
  matchAll: boolean;
  actions: Json[];
  conditions: Json[];
  id: string;
}

const RELAY_STATUS: Record<string, string> = { '0': 'off', '1': 'on', '2': 'previous', power_off: 'off', power_on: 'on', last: 'previous' };

/** Translates one Tuya data point into Zigbee2MQTT values with the feature modules (0008), or explains why not. */
function translateDp(code: string, value: unknown, notes: string[]): Record<string, unknown> | null {
  return translateTuya(code, value, notes);
}

function parseDevices(calls: Json): Map<string, TuyaDevice> {
  const out = new Map<string, TuyaDevice>();
  const add = (raw: unknown) => {
    if (!isObj(raw) || typeof raw.id !== 'string') return;
    const prior = out.get(raw.id);
    const status = new Map<string, unknown>(prior?.status ?? []);
    for (const s of arr(raw.status)) if (isObj(s) && typeof s.code === 'string') status.set(s.code, s.value);
    out.set(raw.id, {
      id: raw.id,
      name: str(raw.name) || prior?.name || '(unnamed)',
      ieee: typeof raw.node_id === 'string' ? ieeeFromNodeId(raw.node_id) : (prior?.ieee ?? null),
      category: str(raw.category) || prior?.category || '',
      productId: str(raw.product_id) || prior?.productId || '',
      status,
    });
  };
  for (const [path, body] of Object.entries(calls)) {
    if (!isObj(body) || body.success === false) continue;
    if (/\/sub-devices$/.test(path) || /\/rooms\/\d+\/devices$/.test(path)) arr(body.result).forEach(add);
    else if (/^\/v1\.0\/devices\/[^/?]+$/.test(path)) add(body.result);
  }
  return out;
}

function parseRules(calls: Json): TuyaRule[] {
  const detailed = new Map<string, TuyaRule>();
  for (const [path, body] of Object.entries(calls)) {
    if (!isObj(body) || !isObj(body.result)) continue;
    if (!/^\/v2\.0\/cloud\/scene\/rule\/[^/?]+$/.test(path)) continue;
    const r = body.result;
    if (typeof r.id !== 'string' || (r.type !== 'scene' && r.type !== 'automation')) continue;
    detailed.set(r.id, {
      id: r.id,
      name: str(r.name),
      type: r.type,
      enabled: r.status !== 'disable',
      // Tuya: 1 = any condition, 2 = all conditions.
      matchAll: r.match_type === 2 || r.match_type === '2',
      actions: arr(r.actions).filter(isObj),
      conditions: arr(r.conditions).filter(isObj),
    });
  }
  return [...detailed.values()];
}

function rooms(calls: Json): { names: string[]; byDevice: Map<string, string> } {
  const names: string[] = [];
  const ids = new Map<string, string>();
  const byDevice = new Map<string, string>();
  for (const [path, body] of Object.entries(calls)) {
    if (/^\/v1\.0\/homes\/[^/]+\/rooms$/.test(path) && isObj(body) && isObj(body.result)) {
      for (const r of arr(body.result.rooms)) {
        if (isObj(r) && str(r.name)) {
          names.push(str(r.name));
          ids.set(String(r.room_id), str(r.name));
        }
      }
    }
  }
  for (const [path, body] of Object.entries(calls)) {
    const m = /^\/v1\.0\/homes\/[^/]+\/rooms\/(\d+)\/devices$/.exec(path);
    const room = m ? ids.get(m[1]!) : undefined;
    if (room && isObj(body)) for (const d of arr(body.result)) if (isObj(d) && typeof d.id === 'string') byDevice.set(d.id, room);
  }
  return { names, byDevice };
}

function zigbeeGroups(calls: Json): Array<{ id: string; name: string; productId: string }> {
  const out: Array<{ id: string; name: string; productId: string }> = [];
  for (const [path, body] of Object.entries(calls)) {
    if (/^\/v2\.0\/cloud\/thing\/group\/[^/]+$/.test(path) && isObj(body) && isObj(body.result) && str(body.result.name)) {
      out.push({ id: String(body.result.id), name: str(body.result.name), productId: str(body.result.product_id) });
    }
  }
  return out;
}

const stepKey = (s: Step) => JSON.stringify(s);

export function importTuyaExport(db: Db, exported: { calls: Json }): ExportImportResult {
  const calls = exported.calls;
  const devices = parseDevices(calls);
  const { names: roomNames, byDevice } = rooms(calls);
  const zigbee = [...devices.values()].filter((d) => d.ieee);

  // A device without a room whose name starts with a room's name goes into that room ("salon góra").
  const roomOf = (d: TuyaDevice) =>
    byDevice.get(d.id) ?? roomNames.filter((r) => d.name.toLowerCase().startsWith(`${r.toLowerCase()} `)).sort((a, b) => b.length - a.length)[0];
  const listing = [...devices.values()].map((d) => ({ name: d.name, node_id: d.ieee ?? undefined, sub: Boolean(d.ieee), room: roomOf(d), icon: tuyaIcon(d.category) }));

  db.exec('BEGIN');
  try {
    const rooms = new Rooms(db);
    for (const [i, r] of roomNames.entries()) rooms.ensure(r, i + 1);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const base = importTuyaListing(db, listing);
  const result: ExportImportResult = { ...base, rooms: roomNames, groups: [], labels: [], actions: [], rules: [], notImported: [], settings: [] };

  // Zigbee groups become planned light groups; Tuya doesn't list their members, so suggest devices of the same product.
  const groups = new LightGroups(db);
  const groupIds = new Map<string, number>();
  for (const g of zigbeeGroups(calls)) {
    const likely = zigbee.filter((d) => g.productId && d.productId === g.productId).map((d) => d.name);
    const note = likely.length
      ? `Imported from Tuya, which doesn't list group members. Probably: ${likely.join(', ')}. Create it when they have all moved.`
      : "Imported from Tuya, which doesn't list group members. Choose them when the devices have moved.";
    const planned = zigbee.filter((d) => g.productId && d.productId === g.productId).map((d) => d.ieee as string);
    groupIds.set(g.id, groups.plan(g.name, note, planned));
    result.groups.push({ name: g.name, note });
  }

  // Device settings to re-apply by hand (switch_type, power-on behaviour).
  for (const d of zigbee) {
    const type = d.status.get('switch_type');
    if (typeof type === 'string') result.settings.push({ device: d.name, setting: 'switch_type', value: type });
    const relay = d.status.get('relay_status');
    if (relay !== undefined) result.settings.push({ device: d.name, setting: 'power_on_behavior', value: RELAY_STATUS[String(relay)] ?? String(relay) });
  }

  // Scenes become draft actions; scenes with the same steps as another become one action.
  const tuyaRules = parseRules(calls);
  const scenes = tuyaRules.filter((r) => r.type === 'scene');
  const automations = tuyaRules.filter((r) => r.type === 'automation');
  const referenced = new Set(automations.flatMap((a) => a.actions.filter((x) => x.action_executor === 'rule_trigger').map((x) => String(x.entity_id))));
  const translated = scenes.map((scene) => {
    const notes: string[] = [];
    const steps: Step[] = [];
    const pairsOf = (a: Json): Array<[string, unknown]> => {
      const prop = isObj(a.executor_property) ? a.executor_property : {};
      return typeof prop.function_code === 'string' ? [[prop.function_code, prop.function_value]] : Object.entries(prop);
    };
    // A scene that ends in white mode shows no colour; Tuya still stores one, which would only flash by.
    const modes = scene.actions.flatMap((a) => pairsOf(a).filter(([code]) => code === 'work_mode').map(([, v]) => v));
    const endsWhite = modes.at(-1) === 'white';
    for (const a of scene.actions) {
      const pairs = pairsOf(a).filter(([code]) => !(endsWhite && code === 'colour_data'));
      if (endsWhite && pairsOf(a).some(([code]) => code === 'colour_data')) notes.push('A colour stored with white mode was left out.');
      const device = devices.get(String(a.entity_id));
      const groupId = groupIds.get(String(a.entity_id));
      for (const [code, value] of pairs) {
        const values = translateDp(code, a.action_executor === 'toggle' && value === undefined ? 'toggle' : value, notes);
        if (!values) continue;
        let step: Step | null = null;
        if (device?.ieee) step = { kind: 'device', device: device.ieee, values };
        else if (groupId !== undefined) step = { kind: 'group', group: groupId, values };
        else notes.push(`Not translated: a step for something that isn't a Zigbee device or group (${String(a.action_executor)}).`);
        // Tuya scenes often repeat the same write; one is enough.
        if (step && (steps.length === 0 || stepKey(steps.at(-1)!) !== stepKey(step))) steps.push(step);
      }
    }
    return { scene, steps, notes: [...new Set(notes)] };
  });
  // Keep the scene an automation runs, or else the first, among scenes with identical steps.
  const keepFor = new Map<string, string>();
  for (const t of [...translated].sort((a, b) => Number(referenced.has(b.scene.id)) - Number(referenced.has(a.scene.id)))) {
    const key = JSON.stringify(t.steps);
    if (t.steps.length && !keepFor.has(key)) keepFor.set(key, t.scene.id);
  }
  const actions = new Actions(db);
  const existingActions = new Map(actions.list().map((a) => [a.name, a.id]));
  const actionFor = new Map<string, number>();
  const nameOf = (id: string) => scenes.find((s) => s.id === id)?.name ?? id;
  for (const t of translated) {
    const name = t.scene.name.replace(/^"(.+)":/, '$1 ').replace(/On\/Off:ON$/, 'ON').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (t.steps.length === 0) {
      result.notImported.push({ name: t.scene.name, reason: `Nothing could be translated. ${t.notes.join(' ')}`.trim() });
      continue;
    }
    const keep = keepFor.get(JSON.stringify(t.steps))!;
    if (keep !== t.scene.id) {
      result.notImported.push({ name: t.scene.name, reason: `Same steps as "${nameOf(keep)}"` });
      continue;
    }
    const notes = ['Imported from the Tuya scene of the same name.', ...t.notes].join(' ');
    let id = existingActions.get(name);
    if (id === undefined) {
      id = actions.create({ name, icon: t.steps.some((s) => s.kind === 'group') ? 'lightbulb' : 'toggle_on', draft: true, notes, steps: t.steps }).id;
      result.actions.push({ name, notes });
    } else {
      result.notImported.push({ name: t.scene.name, reason: 'An action with this name already exists' });
    }
    actionFor.set(t.scene.id, id);
  }
  for (const t of translated) {
    const keep = keepFor.get(JSON.stringify(t.steps));
    if (keep && !actionFor.has(t.scene.id) && actionFor.has(keep)) actionFor.set(t.scene.id, actionFor.get(keep)!);
  }

  // Channel labels from the scenes that remote buttons run: "Desk spot", "Desk lamp", "Desk shelf".
  const labelled = new Map<string, Array<{ endpoint: string; name: string }>>();
  for (const t of translated) {
    if (!referenced.has(t.scene.id) || t.steps.length !== 1 || t.steps[0]!.kind !== 'device') continue;
    const st = t.steps[0]!;
    const keys = Object.keys(st.values);
    const ep = keys.length === 1 ? /^state_(l\d)$/.exec(keys[0]!)?.[1] : undefined;
    if (ep) labelled.set(st.device, [...(labelled.get(st.device) ?? []), { endpoint: ep, name: t.scene.name }]);
  }
  for (const [ieee, entries] of labelled) {
    if (entries.length < 2) continue;
    const words = entries.map((e) => e.name.split(/\s+/));
    let common = 0;
    while (words.every((w) => w.length > common + 1 && w[common] === words[0]![common])) common++;
    for (const [i, e] of entries.entries()) {
      const label = words[i]!.slice(common).join(' ');
      if (new Devices(db).addLabelIfMissing(ieee, e.endpoint, label)) result.labels.push({ device: zigbee.find((d) => d.ieee === ieee)?.name ?? ieee, endpoint: e.endpoint, label });
    }
  }

  // Automations become disabled draft rules.
  const rules = new Rules(db);
  const existingRules = new Set(rules.list().map((r) => r.name));
  for (const auto of automations) {
    const notes: string[] = [];
    const when: Trigger[] = [];
    for (const c of auto.conditions) {
      const device = devices.get(String(c.entity_id));
      const expr = isObj(c.expr) ? c.expr : {};
      const code = typeof expr.status_code === 'string' ? expr.status_code : '';
      const value = expr.status_value;
      const button = /^switch(\d)_value$/.exec(code);
      if (c.entity_type === 'device_report' && device?.ieee && button && ['single_click', 'double_click', 'long_press'].includes(String(value))) {
        when.push({ type: 'button', device: device.ieee, button: Number(button[1]), press: value as PressType });
      } else if (c.entity_type === 'device_report' && device?.ieee && /^switch_\d$/.test(code) && typeof value === 'boolean') {
        when.push({ type: 'state', device: device.ieee, property: `state_l${code.slice(-1)}`, to: value ? 'ON' : 'OFF' });
      } else if (c.entity_type === 'device_report' && device?.ieee && code === 'switch_led' && typeof value === 'boolean') {
        when.push({ type: 'state', device: device.ieee, property: 'state', to: value ? 'ON' : 'OFF' });
      } else {
        notes.push(`Not translated: the Tuya condition ${String(c.entity_type)} ${code} ${JSON.stringify(value ?? null)} (weather, location and sunrise for a city aren't supported).`);
      }
    }
    if (auto.matchAll && when.length > 1) notes.push('Tuya required all of these together; here any one of them starts the rule. Check it.');
    const then: RuleStep[] = [];
    for (const a of auto.actions) {
      if (a.action_executor === 'rule_trigger' && actionFor.has(String(a.entity_id))) then.push({ type: 'action', action: actionFor.get(String(a.entity_id))! });
      else if (a.action_executor === 'delay' && isObj(a.executor_property)) {
        const p = a.executor_property;
        const seconds = Number(p.hours ?? 0) * 3600 + Number(p.minutes ?? 0) * 60 + Number(p.seconds ?? 0);
        if (seconds > 0) then.push({ type: 'wait', seconds });
      } else if (a.action_executor === 'dpIssue' && isObj(a.executor_property)) {
        const device = devices.get(String(a.entity_id));
        for (const [code, value] of Object.entries(a.executor_property)) {
          const values = translateDp(code, value, notes);
          if (values && device?.ieee) then.push({ type: 'device', device: device.ieee, values });
        }
      } else if (a.action_executor === 'rule_enable' || a.action_executor === 'rule_disable') {
        notes.push('Not translated: enabling or disabling another automation from a rule is not in this version.');
      } else {
        notes.push(`Not translated: the Tuya step ${String(a.action_executor)}.`);
      }
    }
    const describe = (t: Trigger) => (t.type === 'button' ? `${zigbee.find((d) => d.ieee === t.device)?.name ?? t.device} button ${t.button} ${t.press}` : '');
    const target = then[0]?.type === 'action' ? actions.get(then[0].action)?.name : undefined;
    const generated = when[0] ? `${describe(when[0]) || 'Tuya automation'}${target ? ` → ${target}` : ''}` : auto.name;
    const name = (/^trigger_|Bind/.test(auto.name) || !auto.name ? generated : auto.name).slice(0, 80);
    if (when.length === 0 || then.length === 0) {
      result.notImported.push({ name, reason: `Nothing to run it on or nothing to do. ${notes.join(' ')}`.trim() });
      continue;
    }
    if (existingRules.has(name)) {
      result.notImported.push({ name, reason: 'A rule with this name already exists' });
      continue;
    }
    if (!auto.enabled) notes.push('It was disabled in Tuya.');
    const text = ['Imported from a Tuya automation that ran on the gateway. Enable it when its devices have moved.', ...new Set(notes)].join(' ');
    rules.create({ name, draft: true, enabled: false, notes: text, when, if: { mode: 'all', conditions: [] }, then });
    existingRules.add(name);
    result.rules.push({ name, notes: text });
  }

  // Remote buttons that switch lights also get the usual light defaults (0008), as disabled drafts:
  // double press = off if on, else full; long press = 20 % dimmer each time, back to full from the lowest step.
  const dimmable = (ieee: string) => zigbee.some((d) => d.ieee === ieee && (d.status.has('bright_value') || d.status.has('bright_value_v2') || LIGHT_CATEGORIES.has(d.category)));
  const lightsOf = (actionId: number): { target: { type: 'group'; group: number } | { type: 'device'; device: string }; probe: string } | null => {
    for (const st of actions.get(actionId)?.steps ?? []) {
      if (st.kind === 'group') {
        const probe = groups.summary(st.group)?.plannedMembers.find(dimmable);
        if (probe) return { target: { type: 'group', group: st.group }, probe };
      }
      if (st.kind === 'device' && dimmable(st.device)) return { target: { type: 'device', device: st.device }, probe: st.device };
    }
    return null;
  };
  const taken = new Set(rules.list().flatMap((r) => r.when.map((t) => (t.type === 'button' ? `${t.device}/${t.button}/${t.press}` : ''))));
  for (const r of rules.list()) {
    const t = r.when[0];
    const first = r.then[0];
    if (r.when.length !== 1 || t?.type !== 'button' || t.press !== 'single_click' || first?.type !== 'action') continue;
    const lights = lightsOf(first.action);
    if (!lights) continue;
    const remote = `${zigbee.find((d) => d.ieee === t.device)?.name ?? t.device} button ${t.button}`;
    const target = actions.get(first.action)?.name ?? 'the lights';
    const step = (values: Record<string, unknown>): RuleStep => ({ ...lights.target, values: { ...values, transition: 1 } });
    const probe = (property: string, op: 'eq' | 'lt', value: unknown) => ({ type: 'state' as const, device: lights.probe, property, op, value });
    const defaults: Array<{ press: PressType; name: string; then: RuleStep[] }> = [
      {
        press: 'double_click',
        name: `${remote} double press → ${target} full / off`,
        then: [{ ...step({ state: 'OFF' }), onlyIf: probe('state', 'eq', 'ON'), stop: true }, step({ state: 'ON', brightness: 254 })],
      },
      {
        press: 'long_press',
        name: `${remote} long press → ${target} dimmer by 20 %`,
        then: [{ ...step({ state: 'ON', brightness: 254 }), onlyIf: probe('brightness', 'lt', 60), stop: true }, step({ brightness_step: -51 })],
      },
    ];
    for (const d of defaults) {
      const name = d.name.slice(0, 80);
      if (taken.has(`${t.device}/${t.button}/${d.press}`) || existingRules.has(name)) continue;
      const notes = `A default for remotes that switch lights, added by the import. Enable it when ${target} works here.`;
      rules.create({ name, draft: true, enabled: false, notes, when: [{ type: 'button', device: t.device, button: t.button, press: d.press }], if: { mode: 'all', conditions: [] }, then: d.then });
      existingRules.add(name);
      taken.add(`${t.device}/${t.button}/${d.press}`);
      result.rules.push({ name, notes });
    }
  }

  new Settings(db).set(IMPORT_REPORT_KEY, { at: new Date().toISOString(), ...result });
  return result;
}
