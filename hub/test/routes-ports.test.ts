import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { Devices } from '../src/devices.js';
import { buildInternalServer } from '../src/server.js';
import type { ZigbeeBridge } from '../src/zigbee.js';
import { FakeDevices } from './fake-devices.js';
import { signIn } from './helpers.js';

// Device routes work through the ports (0015), so a fake stands in for Zigbee2MQTT.
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

describe('device routes through the ports', () => {
  it('reads details again, configures, renames and asks a device to leave', async () => {
    const db = openDatabase(':memory:');
    const fake = new FakeDevices();
    const desk = '0xa4c1380000000001';
    new Devices(db).addPaired(desk, 'biurko');
    const app = buildInternalServer({ db, version: 't', zigbee: fake as unknown as ZigbeeBridge });
    closers.push(() => app.close());
    const cookie = await signIn(app);
    const post = (url: string) => app.inject({ method: 'POST', url, headers: { cookie } });
    expect((await post(`/api/devices/${desk}/interview`)).statusCode).toBe(200);
    expect((await post(`/api/devices/${desk}/configure`)).statusCode).toBe(200);
    expect((await app.inject({ method: 'PATCH', url: `/api/devices/${desk}`, headers: { cookie }, payload: { name: 'Biurko robocze' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `/api/devices/${desk}`, headers: { cookie } })).statusCode).toBe(200);
    expect(fake.interviews).toEqual([desk]);
    expect(fake.configured).toEqual([desk]);
    expect(fake.renames).toEqual([{ ieee: desk, name: 'Biurko robocze' }]);
    expect(fake.left).toEqual([desk]);
  });
});
