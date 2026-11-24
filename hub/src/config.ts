import path from 'node:path';

export interface HubConfig {
  dataDir: string;
  /** Folder for keys and passwords, readable by the hub only. Defaults to the data folder. */
  secretsDir: string;
  internalPort: number;
  mqttUrl: string;
}

function port(value: string | undefined, fallback: number, name: string): number {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number, got "${value}"`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  const dataDir = env.HUB_DATA;
  if (!dataDir) throw new Error('HUB_DATA must point to the data folder');
  return {
    dataDir: path.resolve(dataDir),
    secretsDir: path.resolve(env.HUB_SECRETS_DIR || dataDir),
    internalPort: port(env.HUB_INTERNAL_PORT, 8090, 'HUB_INTERNAL_PORT'),
    mqttUrl: env.HUB_MQTT_URL ?? 'mqtt://127.0.0.1:1883',
  };
}
