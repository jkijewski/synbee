import fs from 'node:fs';
import path from 'node:path';
import { networkSuffix } from './networks.js';

// The coordinator address in use and the guided "replace coordinator" step (0007). The package wizard's address is
// the default; a replacement is saved in the private folder, where the supervisor reads it when it restarts
// Zigbee2MQTT (supervisor/z2m.mjs uses the same file).

const HOST_PORT = /^[A-Za-z0-9.-]{1,253}:(\d{1,5})$/;

export function validAddress(value: unknown): value is string {
  const m = typeof value === 'string' ? HOST_PORT.exec(value) : null;
  return Boolean(m) && Number(m![1]) >= 1 && Number(m![1]) <= 65535;
}

export class CoordinatorError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export class Coordinator {
  constructor(
    private readonly secretsDir: string,
    private readonly wizardAddress: string,
    /** Asks the supervisor to restart Zigbee2MQTT with the current address and any staged backup. */
    private readonly restartZigbee2mqtt: () => boolean,
    /** Which gateway (0023); only the first takes the install wizard's address. */
    private readonly network = 1,
  ) {}

  private get file(): string {
    return path.join(this.secretsDir, `coordinator${networkSuffix(this.network)}`);
  }

  address(): string {
    try {
      const saved = fs.readFileSync(this.file, 'utf8').trim();
      if (validAddress(saved)) return saved;
    } catch {
      // Not replaced through the hub.
    }
    return this.network === 1 && validAddress(this.wizardAddress) ? this.wizardAddress : '';
  }

  replace(input: { address?: unknown; oldDisconnected?: unknown; sameChipFamily?: unknown }): { address: string; restarted: boolean } {
    if (input.oldDisconnected !== true) throw new CoordinatorError('Confirm that the old coordinator is disconnected for good: two coordinators with one network break it');
    if (input.sameChipFamily !== true) throw new CoordinatorError('Confirm that the new coordinator has the same chip family (Silicon Labs, EmberZNet)');
    const address = typeof input.address === 'string' ? input.address.trim() : '';
    if (!validAddress(address)) throw new CoordinatorError('Use host:port, for example 192.168.1.50:6638');
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, `${address}\n`, { mode: 0o600 });
    return { address, restarted: this.restartZigbee2mqtt() };
  }

  /** The first address of a gateway that has none yet, e.g. one just added (0023); no replacement checks needed. */
  setFirst(input: { address?: unknown }): { address: string; restarted: boolean } {
    if (this.address()) throw new CoordinatorError('This gateway already has an address; use "Replace the gateway" to change it', 409);
    const address = typeof input.address === 'string' ? input.address.trim() : '';
    if (!validAddress(address)) throw new CoordinatorError('Use host:port, for example 192.168.1.50:6638');
    fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.file, `${address}\n`, { mode: 0o600 });
    return { address, restarted: this.restartZigbee2mqtt() };
  }

  restart(): boolean {
    return this.restartZigbee2mqtt();
  }
}
