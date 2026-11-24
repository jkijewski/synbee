import fs from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { autoIcon, SUGGESTED_ICONS, tuyaIcon } from '../src/device-icons.js';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { sampleDevices } from '../src/sim/sample-devices.js';
import { signIn } from './helpers.js';
import { tuyaExport } from './fixtures-tuya-export.js';

const symbols = fs.readFileSync(createRequire(import.meta.url).resolve('material-symbols/index.d.ts'), 'utf8');
const exists = (name: string) => symbols.includes(`"${name}"`);
const def = (name: string) => sampleDevices.find((d) => d.friendly_name === name)!.definition;

describe('device icons', () => {
  it('picks an icon from what the device can do', () => {
    expect(autoIcon(def('biurko robocze'))).toBe('toggle_on');
    expect(autoIcon(def('Wireless Switch'))).toBe('settings_remote');
    expect(autoIcon({ exposes: [{ type: 'light', features: [{ type: 'binary', property: 'state' }] }] })).toBe('lightbulb');
    expect(autoIcon({ exposes: [{ type: 'switch', features: [{ property: 'state' }] }, { type: 'numeric', property: 'power' }] })).toBe('smart_outlet');
    expect(autoIcon({ exposes: [{ type: 'binary', property: 'contact' }] })).toBe('sensor_door');
    expect(autoIcon({ exposes: [{ type: 'numeric', property: 'temperature' }] })).toBe('thermometer');
    expect(autoIcon(null)).toBeNull();
    expect(tuyaIcon('dd')).toBe('lightbulb');
    expect(tuyaIcon('nope')).toBeNull();
  });

  it('only uses names that exist in the bundled Material Symbols font', () => {
    const used = [...SUGGESTED_ICONS, ...['dd', 'tdq', 'wxkg', 'pc', 'cl', 'mcs', 'pir', 'wsdcg', 'ywbj', 'sj', 'wk', 'ms'].map((c) => tuyaIcon(c)!)];
    expect(used.filter((n) => !exists(n))).toEqual([]);
  });

  it('shows imported and chosen icons, and goes back to the automatic one', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test' });
    const headers = { cookie: await signIn(app) };
    await app.inject({ method: 'POST', url: '/api/import/tuya', payload: tuyaExport, headers });
    const icons = () => app.inject({ method: 'GET', url: '/api/devices', headers }).then((r) => Object.fromEntries(r.json().map((d: { name: string; icon: string }) => [d.name, d.icon])));
    expect(await icons()).toEqual({
      'biurko robocze': 'toggle_on',
      'salon góra': 'lightbulb',
      'salon półka': 'lightbulb',
      'salon regał': 'lightbulb',
      'Wireless Switch': 'settings_remote',
    });
    const url = '/api/devices/0x60a423fffe000003';
    expect((await app.inject({ method: 'PATCH', url, headers, payload: { icon: 'floor_lamp' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({ icon: 'floor_lamp', autoIcon: 'lightbulb', iconChosen: true });
    expect((await app.inject({ method: 'PATCH', url, headers, payload: { icon: '<script>' } })).statusCode).toBe(400);
    await app.inject({ method: 'PATCH', url, headers, payload: { icon: null } });
    expect((await app.inject({ method: 'GET', url, headers })).json()).toMatchObject({ icon: 'lightbulb', iconChosen: false });
    await app.close();
  });
});
