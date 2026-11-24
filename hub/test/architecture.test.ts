import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The architecture rules of decision 0015, checked on the source so they can't erode quietly.
const SRC = path.resolve(__dirname, '../src');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
const SOURCES = files(SRC).map((f) => ({ file: path.relative(SRC, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));
const importsOf = (text: string) => [...text.matchAll(/^(?:import|export)[^'"]*from '([^']+)'/gm)].map((m) => m[1]!);
const resolveLocal = (from: string, spec: string) => path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.js$/, '.ts');

/** Which module may write each table. Rooms owns the room columns of `devices` (room_id). */
const OWNERS: Record<string, string[]> = {
  users: ['auth.ts'],
  sessions: ['auth.ts'],
  // Created by early migrations and dropped by a later one: nobody writes them.
  app_tokens: [],
  pairing_codes: [],
  action_users: [],
  settings: ['settings.ts'],
  devices: ['devices.ts', 'rooms.ts'],
  channel_labels: ['devices.ts'],
  rooms: ['rooms.ts'],
  device_rooms: ['rooms.ts'],
  light_groups: ['groups.ts'],
  actions: ['actions.ts'],
  action_steps: ['actions.ts'],
  rules: ['rules.ts'],
  rule_runs: ['rule-runs.ts'],
  readings_raw: ['history.ts'],
  readings_5m: ['history.ts'],
  readings_1h: ['history.ts'],
  value_since: ['history.ts'],
  energy_daily: ['energy.ts'],
  energy_counter: ['energy.ts'],
  notifications: ['notifications.ts'],
  duration_timers: ['rule-durations.ts'],
  later_steps: ['rule-later.ts'],
  migration_log: ['db.ts'],
  members: ['members.ts'],
  member_revoked_actions: ['members.ts'],
  member_revoked_rooms: ['members.ts'],
  member_phones: ['members.ts'],
  member_pairing_codes: ['members.ts'],
  member_hidden_tiles: ['members.ts'],
  sensor_groups: ['sensor-groups.ts'],
  sensor_group_members: ['sensor-groups.ts'],
  checks: ['checks.ts'],
  device_tiles: ['tiles.ts'],
};

/** Pure modules: no storage, network, processes or adapters, so the web UI can share them. */
const PURE = /^(features\/.*|exposes|buttons|device-icons|device-kinds|ports|rule-match|room-colors|sun)\.ts$/;
/** Only the HTTP layer knows Fastify. */
const HTTP = /^(server|app-server|routes\/.*)\.ts$/;
/** Only the composition root, the HTTP layer and the gateway's own module use the Zigbee2MQTT bridge directly. */
const MAY_USE_BRIDGE = /^(index|server|gateway|routes\/(gateway|context)|sim\/.*)\.ts$/;

describe('architecture (0015)', () => {
  it('lets only the owning module write each table', () => {
    const tables = [...fs.readFileSync(path.join(SRC, 'db.ts'), 'utf8').matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]!).filter((t) => !t.endsWith('_new'));
    expect(tables.filter((t) => !OWNERS[t])).toEqual([]);
    const wrongWrites: string[] = [];
    for (const { file, text } of SOURCES) {
      if (file === 'db.ts') continue; // migrations
      for (const m of text.matchAll(/\b(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+(\w+)/g)) {
        const table = m[1]!;
        if (OWNERS[table] && !OWNERS[table].includes(file)) wrongWrites.push(`${file} writes ${table}`);
      }
    }
    expect(wrongWrites).toEqual([]);
  });

  it('keeps SQL out of the routes', () => {
    expect(SOURCES.filter((s) => s.file.startsWith('routes/') && /\.prepare\(|\.exec\(/.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('keeps the pure core free of storage, network and adapters', () => {
    const bad = SOURCES.filter((s) => PURE.test(s.file)).flatMap((s) =>
      importsOf(s.text)
        .filter((i) => /^node:(fs|net|http|https|child_process|dgram)$|^(mqtt|fastify)$|\/(db|zigbee|server)\.js$/.test(i))
        .map((i) => `${s.file} imports ${i}`),
    );
    expect(bad).toEqual([]);
  });

  it('uses Fastify only in the HTTP layer, and the Zigbee2MQTT bridge only through the ports elsewhere', () => {
    const bad = SOURCES.flatMap((s) =>
      importsOf(s.text).flatMap((i) => [
        ...(i === 'fastify' && !HTTP.test(s.file) ? [`${s.file} imports fastify`] : []),
        ...(/\/zigbee\.js$/.test(i) && !MAY_USE_BRIDGE.test(s.file) ? [`${s.file} imports the bridge`] : []),
      ]),
    );
    expect(bad).toEqual([]);
  });

  it('lets only the gateway routes reach the bridge; other routes use the ports', () => {
    const bad = SOURCES.filter((s) => s.file.startsWith('routes/') && !/^routes\/(gateway|context)\.ts$/.test(s.file) && /\bzigbee\b/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
  });

  it('has no import cycles', () => {
    const graph = new Map(SOURCES.map((s) => [s.file, importsOf(s.text).filter((i) => i.startsWith('.')).map((i) => resolveLocal(s.file, i))]));
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (f: string, trail: string[]) => {
      if (state.get(f) === 'done') return;
      if (state.get(f) === 'visiting') return void cycles.push([...trail.slice(trail.indexOf(f)), f].join(' → '));
      state.set(f, 'visiting');
      for (const next of graph.get(f) ?? []) visit(next, [...trail, f]);
      state.set(f, 'done');
    };
    for (const f of graph.keys()) visit(f, []);
    expect(cycles).toEqual([]);
  });
});
