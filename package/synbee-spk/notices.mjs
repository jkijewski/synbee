// Writes THIRD-PARTY-NOTICES.txt for the package: every bundled npm package with its version, licence and licence
// text. Usage: node notices.mjs OUT_FILE NODE_MODULES_DIR... [--web HUB_NODE_MODULES name...]
import fs from 'node:fs';
import path from 'node:path';

const [out, ...rest] = process.argv.slice(2);
const webAt = rest.indexOf('--web');
const dirs = webAt === -1 ? rest : rest.slice(0, webAt);
const webDir = webAt === -1 ? null : rest[webAt + 1];
const webNames = webAt === -1 ? [] : rest.slice(webAt + 2);

const seen = new Map();
function addPackage(dir) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return;
  }
  if (!pkg.name || !pkg.version) return;
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  const licenceFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(f));
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? (pkg.licenses ?? []).map((l) => l.type).join(' OR ')) || 'see text';
  seen.set(key, { key, licence, text: licenceFile ? fs.readFileSync(path.join(dir, licenceFile), 'utf8').trim() : '' });
}
function walk(nodeModules) {
  if (!fs.existsSync(nodeModules)) return;
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(nodeModules, entry);
    if (entry.startsWith('@')) {
      for (const sub of fs.readdirSync(full)) {
        addPackage(path.join(full, sub));
        walk(path.join(full, sub, 'node_modules'));
      }
    } else {
      addPackage(full);
      walk(path.join(full, 'node_modules'));
    }
  }
}
for (const d of dirs) walk(d);
// Packages compiled into the web UI's JavaScript and fonts, with what they depend on.
const webQueue = [...webNames];
while (webQueue.length) {
  const name = webQueue.shift();
  const dir = path.join(webDir, name);
  addPackage(dir);
  try {
    webQueue.push(...Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).dependencies ?? {}));
  } catch {
    // not installed
  }
}

const list = [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
const header = [
  'SynBee itself is licensed under the MIT licence; see LICENSE.',
  'It is provided "as is", without any warranty, and its authors accept no responsibility or liability',
  'for it under any circumstances; see DISCLAIMER.md.',
  'It bundles the third-party software listed below, each under its own licence.',
  'Zigbee2MQTT, zigbee-on-host and the two Zigbee2MQTT web frontends are licensed under the GNU GPL v3.',
  'Their complete source code, at the exact versions bundled, is in third-party-sources/, with links to',
  'each upstream release in third-party-sources/README.md.',
  'Node.js is licensed under the MIT licence; its licence is in node/LICENSE.',
  '',
  'Summary:',
  ...list.map((p) => `  ${p.key}: ${p.licence}`),
  '',
];
const body = list.filter((p) => p.text).map((p) => `${'='.repeat(78)}\n${p.key} (${p.licence})\n${'='.repeat(78)}\n${p.text}\n`);
fs.writeFileSync(out, `${header.join('\n')}\n${body.join('\n')}`);
console.log(`${list.length} packages in ${out}`);
