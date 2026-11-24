import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA, openDatabase } from '../src/db.js';
import { buildInternalServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

describe('internal server', () => {
  it('reports health', async () => {
    const app = buildInternalServer({ db: openDatabase(':memory:'), version: 'test' });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, version: 'test', schema: LATEST_SCHEMA, users: 1 });
    await app.close();
  });
});

describe('config', () => {
  it('requires a data folder and validates ports', () => {
    expect(() => loadConfig({})).toThrow(/HUB_DATA/);
    expect(() => loadConfig({ HUB_DATA: '/tmp/x', HUB_INTERNAL_PORT: 'abc' })).toThrow(/port/);
    expect(loadConfig({ HUB_DATA: '/tmp/x' }).internalPort).toBe(8090);
  });
});
