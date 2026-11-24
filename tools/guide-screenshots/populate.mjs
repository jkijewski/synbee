// Fills a simulator hub with a sample home for the user guide's screenshots, through its own API. Usage: node populate.mjs BASE_URL PASSWORD
const base = process.argv[2];
const PASSWORD = process.argv[3];
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', origin: base, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : method === 'GET' ? undefined : '{}' });
  const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  if (res.status >= 400) throw new Error(`${method} ${path} ${res.status} ${text}`);
  return json;
}
const soft = (p) => p.catch((e) => console.log('!', e.message));
try { await api('POST', '/api/auth/setup', { password: PASSWORD }); } catch { await api('POST', '/api/auth/login', { password: PASSWORD }); }
await soft(api('POST', '/api/coordinator/address', { address: '192.168.1.30:6638' }));
await soft(api('PUT', '/api/location', { latitude: 52.23, longitude: 21.01 }));
let devices = [];
for (let i = 0; i < 30; i++) { const r = await api('GET', '/api/devices'); devices = r.devices ?? r; if (devices.length > 10) break; await new Promise((r) => setTimeout(r, 1000)); }
const rooms = {};
for (const [name, icon] of [['Living room', 'weekend'], ['Bedroom', 'bed'], ['Kitchen', 'kitchen'], ['Hall', 'door_front'], ['Bathroom', 'bathtub'], ['Study', 'desk']]) {
  rooms[name] = (await api('POST', '/api/rooms', { name, icon })).id;
}
const plan = {
  '0xa4c1380000000001': ['Desk switch', 'Study'],
  '0xa4c1380000000002': ['Living room remote', 'Living room'],
  '0x60a423fffe000001': ['Ceiling light', 'Living room'],
  '0x60a423fffe000002': ['Shelf light', 'Living room'],
  '0x60a423fffe000003': ['Corner lamp', 'Living room'],
  '0x00158d0000000102': ['Leak sensor', 'Bathroom'],
  '0x00158d0000000106': ['Desk plug', 'Study'],
  '0x00158d0000000101': ['Front door', 'Hall'],
  '0x00158d0000000104': ['Door lock', 'Hall'],
  '0x00158d0000000103': ['Hall motion', 'Hall'],
  '0x00158d0000000107': ['Climate sensor', 'Living room'],
  '0x00158d0000000105': ['Radiator', 'Bedroom'],
};
for (const [ieee, [name, room]] of Object.entries(plan)) await soft(api('PATCH', `/api/devices/${ieee}`, { name, room }));
await soft(api('PUT', '/api/devices/0xa4c1380000000001/labels', { l1: 'Lamp', l2: 'Spot', l3: 'Shelf' }));
const group = await api('POST', `/api/rooms/${rooms['Living room']}/light-group`);
const gid = group.id ?? group.group?.id;
await new Promise((r) => setTimeout(r, 2000));
const a = async (name, icon, description, steps) => (await api('POST', '/api/actions', { name, icon, description, steps })).id;
const on = await a('Living room on', 'lightbulb', 'All living room lights, bright and warm', [{ kind: 'group', group: gid, values: { state: 'ON', brightness: 230, color_temp: 370 } }]);
await a('Movie time', 'movie', 'Dim, warm light for watching', [{ kind: 'group', group: gid, values: { state: 'ON', brightness: 40, color_temp: 450 } }]);
const off = await a('Living room off', 'light_off', 'Everything off', [{ kind: 'group', group: gid, values: { state: 'OFF' } }]);
await a('Study lamp', 'desk', 'The desk lamp on', [{ kind: 'device', device: '0xa4c1380000000001', values: { state_l1: 'ON' } }]);
await api('POST', '/api/rules', { name: 'Evening lights', enabled: true, when: [{ type: 'sun', event: 'sunset', offset: -15, days: [1, 2, 3, 4, 5, 6, 7] }], then: [{ type: 'action', action: on }] });
await api('POST', '/api/rules', { name: 'Remote: living room', enabled: true, when: [{ type: 'button', device: '0xa4c1380000000002', button: 1, press: 'single_click' }], if: undefined, then: [{ type: 'action', action: on, onlyIf: { type: 'group', group: gid, is: 'off' }, stop: true }, { type: 'action', action: off }] });
await api('POST', '/api/rules', { name: 'Leak alarm', enabled: true, when: [{ type: 'state', device: '0x00158d0000000102', property: 'water_leak', to: true }], then: [{ type: 'notify', text: 'Water leak in the bathroom', level: 'alarm' }] });
await api('POST', '/api/rules', { name: 'Hall light at night', enabled: true, when: [{ type: 'state', device: '0x00158d0000000103', property: 'occupancy', to: true }], if: { mode: 'all', conditions: [{ type: 'sun', is: 'dark' }] }, then: [{ type: 'device', device: '0x00158d0000000106', values: { state: 'ON' } }, { type: 'later', minutes: 5, step: { type: 'device', device: '0x00158d0000000106', values: { state: 'OFF' } } }] }).catch((e) => console.log('!', e.message));
// Sensor group, check, device tile and an action with "Only when", for the 1.1 pages.
const openings = await api('POST', '/api/sensor-groups', { name: 'Doors & windows', roomId: rooms['Hall'], labels: { active: 'open', inactive: 'closed' }, members: [{ ieee: '0x00158d0000000101', property: 'contact' }] });
await soft(api('PUT', '/api/devices/0x00158d0000000107/tile', { on: true, property: 'temperature' }));
const closedCheck = await api('POST', '/api/checks', {
  name: 'Ready to leave',
  roomId: rooms['Hall'],
  if: { mode: 'all', conditions: [{ type: 'sensors', group: openings.id, is: 'none' }, { type: 'state', device: '0x00158d0000000104', property: 'lock_state', op: 'eq', value: 'locked' }] },
  whenTrue: { text: 'Ready: closed and locked', level: 'fine' },
  whenFalse: { text: 'Not ready', level: 'warning' },
});
await api('POST', '/api/actions', { name: 'Away mode', icon: 'luggage', description: 'Everything off, only when ready to leave', if: { mode: 'all', conditions: [{ type: 'check', check: closedCheck.id, is: true }] }, steps: [{ kind: 'group', group: gid, values: { state: 'OFF' } }] });
await api('POST', '/api/rules', { name: 'Door left open', enabled: true, when: [{ type: 'sensors', group: openings.id, becomes: 'some', forMinutes: 5 }], then: [{ type: 'notify', level: 'warning', text: '{device}: {state} for {duration}' }] });
const anna = await api('POST', '/api/members', { name: 'Anna' });
await api('POST', '/api/members', { name: 'Tom' });
await soft(api('POST', `/api/actions/${on}/run`));
console.log('ok', { rooms, gid, on, anna: anna.id });
