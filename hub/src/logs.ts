import fs from 'node:fs';
import path from 'node:path';

// Recent lines of the package's own logs, which live in the private folder, for the owner on the home network.
// Lines that could hold a key or password are hidden.

export const LOG_NAMES = ['hub', 'zigbee2mqtt', 'supervisor'] as const;
export type LogName = (typeof LOG_NAMES)[number];
const SECRET = /(network_key|ext_pan_id|password|passphrase|secret|token|authorization)/i;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function tailLog(dir: string | undefined, name: string, lines = 200): string[] | null {
  if (!dir || !(LOG_NAMES as readonly string[]).includes(name)) return null;
  const file = path.join(dir, `${name}.log`);
  let text: string;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .slice(-Math.max(1, Math.min(lines, 1000)))
    .map((l) => (SECRET.test(l) ? '[line hidden: it may contain a key or password]' : l.replace(ANSI, '')));
}
