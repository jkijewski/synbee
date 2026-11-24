import net from 'node:net';
import os from 'node:os';

// True for loopback, private (RFC 1918), link-local and IPv6 unique-local addresses, including IPv4-mapped IPv6.
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  let ip = address;
  if (ip.startsWith('::ffff:') && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || /^f[cd][0-9a-f]{2}:/.test(lower) || /^fe[89ab][0-9a-f]:/.test(lower);
  }
  return false;
}

/** The NAS's home network IPv4 addresses, for the app's pairing code: real interfaces only, 192.168.x first. */
export function homeAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found: string[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (/^(lo|docker|br-|veth|virbr|tun|tap|wg|tailscale)/.test(name)) continue;
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal && isLocalAddress(i.address) && !i.address.startsWith('169.254.')) found.push(i.address);
  }
  const rank = (a: string) => (a.startsWith('192.168.') ? 0 : a.startsWith('10.') ? 1 : 2);
  return [...new Set(found)].sort((a, b) => rank(a) - rank(b));
}

/** This NAS's address as another device on the network sees it: the local end of a connection to that device. */
export function localAddressTowards(host: string, port = 80, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`${host} did not answer`))), timeoutMs);
    socket.once('connect', () => {
      const local = socket.localAddress?.replace(/^::ffff:/, '') ?? '';
      done(() => (local ? resolve(local) : reject(new Error('No local address'))));
    });
    socket.once('error', (err) => done(() => reject(err)));
  });
}
