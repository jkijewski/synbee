import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { LightGroups } from '../src/groups.js';
import { Rules } from '../src/rules.js';
import { Actions } from '../src/actions.js';
import { buildInternalServer } from '../src/server.js';
import { importTuyaExport } from '../src/tuya-export.js';
import { signIn } from './helpers.js';
import { tuyaExport } from './fixtures-tuya-export.js';

describe('Tuya configuration export import', () => {
  it('imports names, rooms, labels and the group, and keeps no Tuya IDs', () => {
    const db = openDatabase(':memory:');
    const result = importTuyaExport(db, structuredClone(tuyaExport));
    expect(result.rooms).toEqual(['gabinet', 'salon']);
    const devices = db.prepare('SELECT d.name, r.name AS room, d.status FROM devices d LEFT JOIN rooms r ON r.id = d.room_id ORDER BY d.name COLLATE NOCASE').all();
    expect(devices.map((d) => ({ ...d }))).toEqual([
      { name: 'biurko robocze', room: 'gabinet', status: 'pending' },
      { name: 'salon góra', room: 'salon', status: 'pending' },
      { name: 'salon półka', room: 'salon', status: 'pending' },
      { name: 'salon regał', room: 'salon', status: 'pending' },
      { name: 'Wireless Switch', room: 'gabinet', status: 'pending' },
    ]);
    expect(result.skipped).toEqual([{ name: 'Smart Gateway', reason: 'gateway, not a Zigbee device' }]);
    expect(result.labels.map((l) => [l.endpoint, l.label]).sort()).toEqual([
      ['l1', 'spot'],
      ['l2', 'lamp'],
      ['l3', 'shelf'],
    ]);
    const group = new LightGroups(db).list()[0]!;
    expect(group).toMatchObject({ name: 'salon światła', created: false });
    expect(group.plannedMembers.map((m) => m.name)).toEqual(['salon góra', 'salon półka', 'salon regał']);
    expect(result.settings).toEqual([
      { device: 'biurko robocze', setting: 'switch_type', value: 'flip' },
      { device: 'biurko robocze', setting: 'power_on_behavior', value: 'previous' },
    ]);
    const everything = JSON.stringify(
      ['devices', 'rooms', 'actions', 'action_steps', 'rules', 'settings', 'light_groups', 'channel_labels'].map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
    );
    expect(everything).not.toMatch(/dev-desk|dev-remote|s-spot|"777"|prod-bulb/);
  });

  it('turns scenes into draft actions, merging duplicates and translating colours', () => {
    const db = openDatabase(':memory:');
    const result = importTuyaExport(db, structuredClone(tuyaExport));
    const actions = new Actions(db).list();
    expect(actions.map((a) => a.name).sort()).toEqual(['Desk lamp', 'Desk shelf', 'Desk spot', 'salon red', 'salon światła ON']);
    expect(actions.every((a) => a.draft)).toBe(true);
    expect(actions.find((a) => a.name === 'Desk spot')!.steps).toEqual([{ kind: 'device', device: '0xa4c1380000000001', values: { state_l1: 'TOGGLE' } }]);
    const red = actions.find((a) => a.name === 'salon red')!;
    expect(red.steps.map((s) => (s.kind === 'group' ? s.values : null))).toEqual([
      { color: { hue: 6, saturation: 100 }, brightness: 92 },
      { state: 'ON' },
      { color: { hue: 0, saturation: 100 }, brightness: 254 },
    ]);
    expect(red.notes).toMatch(/check them by eye/);
    const white = actions.find((a) => a.name === 'salon światła ON')!;
    expect(white.steps.map((s) => (s.kind === 'group' ? s.values : null))).toEqual([{ state: 'ON' }, { color_temp: 250 }]);
    expect(result.notImported).toEqual(
      expect.arrayContaining([
        { name: 'Desk 1', reason: 'Same steps as "Desk spot"' },
        expect.objectContaining({ name: 'music', reason: expect.stringMatching(/Nothing could be translated.*music_data/) }),
        expect.objectContaining({ name: 'Sunset lights', reason: expect.stringMatching(/weather/) }),
      ]),
    );
  });

  it('turns button automations into disabled draft rules that become ready when the devices have moved', () => {
    const db = openDatabase(':memory:');
    importTuyaExport(db, structuredClone(tuyaExport));
    const rules = new Rules(db);
    const list = rules.list();
    expect(list.map((r) => r.name).sort()).toEqual([
      'Wireless Switch button 1 single_click → Desk spot',
      'Wireless Switch button 2 single_click → Desk lamp',
      'Wireless Switch button 3 single_click → Desk shelf',
    ]);
    const b1 = list.find((r) => r.name.includes('button 1'))!;
    expect(b1).toMatchObject({ enabled: false, draft: true, when: [{ type: 'button', device: '0xa4c1380000000002', button: 1, press: 'single_click' }] });
    expect(b1.then).toEqual([{ type: 'action', action: new Actions(db).list().find((a) => a.name === 'Desk spot')!.id }]);
    expect(b1.readiness).toEqual({ ready: false, missing: ['Wireless Switch (not moved yet)'] });
    expect(() => rules.setEnabled(b1.id, true)).toThrow(/Can't enable yet/);
    db.prepare("UPDATE devices SET status = 'joined'").run();
    expect(rules.setEnabled(b1.id, true)).toMatchObject({ enabled: true, draft: false });
  });

  it('gives remote buttons that switch lights the double-press and long-press light defaults', () => {
    const db = openDatabase(':memory:');
    const exported = structuredClone(tuyaExport) as { calls: Record<string, { result: { actions: Array<{ entity_id: string }> } }> };
    exported.calls['/v2.0/cloud/scene/rule/a1']!.result.actions[0]!.entity_id = 's-red';
    importTuyaExport(db, exported);
    const list = new Rules(db).list();
    const group = new LightGroups(db).list()[0]!.id;
    const double = list.find((r) => r.name === 'Wireless Switch button 1 double press → salon red full / off')!;
    expect(double).toMatchObject({ enabled: false, draft: true, when: [{ type: 'button', device: '0xa4c1380000000002', button: 1, press: 'double_click' }] });
    expect(double.then).toEqual([
      { type: 'group', group, values: { state: 'OFF', transition: 1 }, onlyIf: { type: 'state', device: '0x60a423fffe000001', property: 'state', op: 'eq', value: 'ON' }, stop: true },
      { type: 'group', group, values: { state: 'ON', brightness: 254, transition: 1 } },
    ]);
    const long = list.find((r) => r.name === 'Wireless Switch button 1 long press → salon red dimmer by 20 %')!;
    expect(long.when).toEqual([{ type: 'button', device: '0xa4c1380000000002', button: 1, press: 'long_press' }]);
    expect(long.then[1]).toEqual({ type: 'group', group, values: { brightness_step: -51, transition: 1 } });
    // Buttons that switch relays (Desk lamp, regał) get no light defaults.
    expect(list.filter((r) => r.name.includes('button 2'))).toHaveLength(1);
  });

  it('can be run again without duplicating anything', () => {
    const db = openDatabase(':memory:');
    importTuyaExport(db, structuredClone(tuyaExport));
    const again = importTuyaExport(db, structuredClone(tuyaExport));
    expect(again.actions).toEqual([]);
    expect(again.rules).toEqual([]);
    expect(new Actions(db).list()).toHaveLength(5);
    expect(new Rules(db).list()).toHaveLength(3);
    expect(new LightGroups(db).list()).toHaveLength(1);
  });

  it('is accepted by the import endpoint, with the report kept for later', async () => {
    const db = openDatabase(':memory:');
    const app = buildInternalServer({ db, version: 'test' });
    expect((await app.inject({ method: 'POST', url: '/api/import/tuya', payload: tuyaExport })).statusCode).toBe(401);
    const headers = { cookie: await signIn(app) };
    const res = await app.inject({ method: 'POST', url: '/api/import/tuya', headers, payload: tuyaExport });
    expect(res.statusCode).toBe(200);
    expect(res.json().rules).toHaveLength(3);
    const report = (await app.inject({ method: 'GET', url: '/api/import/tuya/report', headers })).json();
    expect(report.actions).toHaveLength(5);
    await app.close();
  });
});
