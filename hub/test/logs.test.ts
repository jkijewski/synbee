import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { tailLog } from '../src/logs.js';
import { signIn } from './helpers.js';

describe('package logs', () => {
  it('shows recent lines to a signed-in owner, hiding lines that may hold secrets', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synbee-logs-'));
    fs.writeFileSync(
      path.join(dir, 'zigbee2mqtt.log'),
      ['\u001b[32minfo\u001b[39m: Starting Zigbee2MQTT', 'network_key: [1, 2, 3]', 'mqtt password: abc', 'error: connect ECONNREFUSED 127.0.0.1:6638', ''].join('\n'),
    );
    expect(tailLog(dir, 'zigbee2mqtt', 2)).toEqual(['[line hidden: it may contain a key or password]', 'error: connect ECONNREFUSED 127.0.0.1:6638']);
    expect(tailLog(dir, '../secrets/tls-key')).toBeNull();
    expect(tailLog(dir, 'hub')).toEqual([]);
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test', logDir: dir });
    expect((await app.inject({ method: 'GET', url: '/api/logs/zigbee2mqtt' })).statusCode).toBe(401);
    const headers = { cookie: await signIn(app) };
    const lines = (await app.inject({ method: 'GET', url: '/api/logs/zigbee2mqtt', headers })).json().lines;
    expect(lines[0]).toBe('info: Starting Zigbee2MQTT');
    expect(JSON.stringify(lines)).not.toMatch(/\[1, 2, 3\]|abc/);
    expect((await app.inject({ method: 'GET', url: '/api/logs/other', headers })).statusCode).toBe(404);
    await app.close();
  });
});
