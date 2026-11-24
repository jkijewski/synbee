import { launch } from './cdp.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(new URL('../../hub/package.json', import.meta.url));
const QRCode = require('qrcode');
const [base, pwFile, out] = process.argv.slice(2);
// Usage: node shots.mjs http://127.0.0.1:18190 PASSWORD_FILE OUT_DIR
fs.mkdirSync(out, { recursive: true });
const b = await launch();
const scrub = () => b.eval(`(() => { const names = { 'biurko robocze': 'Desk switch', 'Wireless Switch': 'Living room remote', salon_gora: 'Ceiling light', salon_polka: 'Shelf light', salon_regal: 'Corner lamp', front_door: 'Front door', bathroom_leak: 'Leak sensor', front_lock: 'Door lock', hall_motion: 'Hall motion', radiator: 'Radiator', desk_plug: 'Desk plug', living_climate: 'Climate sensor' }; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (names[n.nodeValue.trim()]) n.nodeValue = names[n.nodeValue.trim()]; n.nodeValue = n.nodeValue.replace(/127\\.0\\.0\\.1:18190/g, '192.168.1.20:8090').replace(/\\b(?:\\d{1,3}\\.){3}\\d{1,3}(:\\d+)?/g, (m, p) => m.startsWith('192.168.1.30') || m.startsWith('192.168.1.20') ? m : '192.168.1.20' + (p ?? '')).replace(/\\b18443\\b/g, '8443').replace(/\\b18190\\b/g, '8090'); } document.querySelectorAll('input').forEach((i) => { if (i.value === '18443') i.value = '8443'; if (i.placeholder) i.placeholder = i.placeholder.replace(/\\b18443\\b/g, '8443'); }); })()`);
const shot = async (name, full = false) => { await scrub(); await b.sleep(300); await b.shot(`${out}/${name}.png`, { full }); console.log(name); };
await b.go(base, 2000);
await shot('sign-in');
await b.eval(`fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: ${JSON.stringify(fs.readFileSync(pwFile, 'utf8'))} }) }).then((r) => r.status)`).then((s) => console.log('login', s));
await b.send('Page.reload'); await b.sleep(2000);
const pages = [['devices', 'devices'], ['devices/0x60a423fffe000001', 'device-light', true], ['devices/0x00158d0000000107', 'device-sensor', true], ['rooms', 'rooms'], ['actions', 'actions'], ['rules', 'automations'], ['rules/2', 'automation-editor', true], ['rules/4', 'automation-timer', true], ['groups', 'light-groups'], ['sensors', 'sensor-groups'], ['checks', 'checks'], ['actions/5', 'action-only-when', true], ['rules/5', 'automation-sensor-group', true], ['pairing', 'add-devices'], ['gateway', 'gateway', true], ['status', 'status', true], ['notifications', 'notifications']];
for (const [hash, name, full] of pages) { await b.go(`${base}/#${hash}`, 2200); await shot(name, full); }
// Editors and menus opened by a click: sensor group and check editors, the Administration menu.
const clickShot = async (hash, button, name, full = true) => {
  await b.go(`${base}/#${hash}`, 2200);
  await b.eval(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(button)})?.click()`);
  await b.sleep(1200);
  await shot(name, full);
};
await clickShot('sensors', 'Edit', 'sensor-group-editor');
await clickShot('checks', 'Edit', 'check-editor');
await clickShot('devices', 'Administration', 'administration-menu', false);
await b.go(`${base}/#members`, 2200);
await b.eval(`[...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Pair a phone')?.click()`);
await b.sleep(1500);
const fake = await QRCode.toDataURL(JSON.stringify({ v: 1, hub: 'synbee', a: ['192.168.1.20:8443'], fp: 'U2FtcGxlIGtleSBmaW5nZXJwcmludCBmb3IgdGhlIGd1aWRlcw==', c: 'K7M4Q-X92PA' }), { margin: 1, width: 260 });
await b.eval(`(() => { document.querySelectorAll('img[alt^="Pairing QR"]').forEach((i) => (i.src = ${JSON.stringify(fake)})); document.querySelectorAll('strong, code').forEach((e) => { const t = e.textContent.trim(); if (/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(t)) e.textContent = 'K7M4Q-X92PA'; if (/^[0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4} [0-9A-F]{4}$/.test(t)) e.textContent = '53A1 9C2E 7F04 B6D8'; }); })()`);
await shot('app-users', true);
await b.close();
