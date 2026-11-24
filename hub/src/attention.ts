import type { Devices } from './devices.js';
import { flattenExposes } from './exposes.js';
import { attentionFor, featureFor, wordFor } from './features/index.js';
import type { GatewayWebStatus } from './gateway-web.js';
import type { DeviceControl } from './ports.js';

// What needs someone's attention now (0008): alarms first (leak, smoke, gas), then warnings (low battery, tamper,
// a lock not fully locked, devices Zigbee2MQTT reports offline). Decided by the feature modules, so a new kind of
// sensor only has to say when its value is a problem.

export interface AttentionItem {
  ieee: string;
  name: string;
  level: 'alarm' | 'warning';
  /** What is wrong, in words: "Water leak: Wet", "Battery: 11 %", "Offline". */
  what: string;
}

export function attentionList(devices: Devices, control: DeviceControl | undefined, gatewayWeb?: GatewayWebStatus): AttentionItem[] {
  if (!control) return [];
  const items: AttentionItem[] = [];
  // Without the gateway nothing can be switched or heard, so it comes first.
  if (control.gatewayOnline() === false) items.push({ ieee: '', name: 'Zigbee gateway', level: 'alarm', what: 'Not connected: devices can neither be switched nor heard' });
  // Its own web page open to anyone on the network: settings, firmware and the socket's protection (0007).
  if (gatewayWeb?.web === 'open') items.push({ ieee: '', name: 'Zigbee gateway', level: 'warning', what: 'Its web page has no password: turn on web server authentication there' });
  for (const row of devices.list().filter((d) => d.status === 'joined')) {
    if (control.isOnline(row.ieee) === false) {
      items.push({ ieee: row.ieee, name: row.name, level: 'warning', what: 'Offline' });
      continue;
    }
    const z = control.knownDevices().find((d) => d.ieee_address.toLowerCase() === row.ieee);
    const state = control.deviceState(row.ieee) ?? {};
    for (const prop of flattenExposes(z?.definition?.exposes)) {
      const value = state[prop.property];
      const level = attentionFor(prop, value);
      if (!level) continue;
      const f = featureFor(prop);
      const shown = f.words ? wordFor(prop, value) : `${String(value)}${f.unit ? ` ${f.unit}` : ''}`;
      items.push({ ieee: row.ieee, name: row.name, level, what: `${f.label}: ${shown}` });
    }
  }
  return items.sort((a, b) => (a.ieee === '' ? -1 : b.ieee === '' ? 1 : a.level === b.level ? a.name.localeCompare(b.name) : a.level === 'alarm' ? -1 : 1));
}
