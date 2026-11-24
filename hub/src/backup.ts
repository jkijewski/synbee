import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from './settings.js';

// Coordinator backup (0007): status for the hub's status page, an encrypted download of Zigbee2MQTT's network
// backup and device database, and restoring such a download. The backup holds the Zigbee network key, so its
// contents are never shown, logged or written outside the package's private folder unencrypted.

/** A coordinator backup older than this gets a warning. Zigbee2MQTT rewrites it at every start and once a day. */
export const STALE_AFTER_DAYS = 3;
/** Remind the owner to download a fresh copy when the last one is older than this. */
export const DOWNLOAD_REMINDER_DAYS = 30;
export const MIN_PASSPHRASE = 12;
const MAGIC = Buffer.from('SYNBEE-BACKUP-1\n');
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
/** Files taken from Zigbee2MQTT's data folder. The configuration holds the network key that matches the backup. */
export const BACKUP_FILES = ['coordinator_backup.json', 'database.db', 'configuration.yaml', 'state.json'];
const MAX_ARCHIVE = 20 * 1024 * 1024;
const DOWNLOADED_KEY = 'backup-downloaded-at';

export class BackupError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface BackupStatus {
  present: boolean;
  writtenAt: string | null;
  ageDays: number | null;
  stale: boolean;
  /** The coordinator the backup belongs to, to compare with the one connected now. */
  coordinatorIeee: string | null;
  lastDownloadAt: string | null;
  warnings: string[];
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase.normalize('NFC'), salt, 32, SCRYPT);
}

/** AES-256-GCM with a key derived from the passphrase by scrypt. The passphrase is never stored. */
export function encryptArchive(plain: Buffer, passphrase: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptArchive(archive: Buffer, passphrase: string): Buffer {
  if (archive.length < MAGIC.length + 44 || !archive.subarray(0, MAGIC.length).equals(MAGIC)) throw new BackupError('This is not a SynBee backup file');
  let at = MAGIC.length;
  const salt = archive.subarray(at, (at += 16));
  const iv = archive.subarray(at, (at += 12));
  const tag = archive.subarray(at, (at += 16));
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(archive.subarray(at)), decipher.final()]);
  } catch {
    throw new BackupError('Wrong passphrase, or the file is damaged');
  }
}

export class CoordinatorBackup {
  constructor(
    private readonly z2mDataDir: string | null,
    private readonly settings: Settings,
    private readonly now: () => Date = () => new Date(),
    /** Which gateway (0023): each has its own backup and its own "last downloaded". */
    private readonly network = 1,
  ) {}

  private get downloadedKey(): string {
    return this.network === 1 ? DOWNLOADED_KEY : `${DOWNLOADED_KEY}-${this.network}`;
  }

  private file(name: string): string | null {
    return this.z2mDataDir ? path.join(this.z2mDataDir, name) : null;
  }

  status(): BackupStatus {
    const file = this.file('coordinator_backup.json');
    const lastDownloadAt = this.settings.get<string | null>(this.downloadedKey, null);
    const warnings: string[] = [];
    let stat: fs.Stats | null = null;
    try {
      stat = file ? fs.statSync(file) : null;
    } catch {
      stat = null;
    }
    if (!stat) {
      warnings.push('There is no coordinator backup yet. Zigbee2MQTT writes one once it has started with the coordinator.');
      return { present: false, writtenAt: null, ageDays: null, stale: true, coordinatorIeee: null, lastDownloadAt, warnings };
    }
    const ageDays = (this.now().getTime() - stat.mtime.getTime()) / 86_400_000;
    const stale = ageDays > STALE_AFTER_DAYS;
    if (stale) warnings.push(`The coordinator backup is ${Math.floor(ageDays)} days old. Check that Zigbee2MQTT is running.`);
    if (!lastDownloadAt) warnings.push('Keep a copy off the NAS: download the backup and store it somewhere safe.');
    else if ((this.now().getTime() - Date.parse(lastDownloadAt)) / 86_400_000 > DOWNLOAD_REMINDER_DAYS) {
      warnings.push(`The last downloaded copy is more than ${DOWNLOAD_REMINDER_DAYS} days old. Download a fresh one.`);
    }
    return {
      present: true,
      writtenAt: stat.mtime.toISOString(),
      ageDays: Math.round(ageDays * 10) / 10,
      stale,
      coordinatorIeee: this.backupIeee(),
      lastDownloadAt,
      warnings,
    };
  }

  /** The coordinator IEEE address recorded in the backup; the only field read from it. */
  backupIeee(): string | null {
    const file = this.file('coordinator_backup.json');
    try {
      const data = JSON.parse(fs.readFileSync(file!, 'utf8')) as { coordinator_ieee?: unknown };
      if (typeof data.coordinator_ieee !== 'string') return null;
      const hex = data.coordinator_ieee.toLowerCase().replace(/^0x/, '');
      return /^[0-9a-f]{16}$/.test(hex) ? `0x${hex}` : null;
    } catch {
      return null;
    }
  }

  /** The encrypted archive: Zigbee2MQTT's coordinator backup, device database, configuration and state. */
  download(passphrase: string): { filename: string; data: Buffer } {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) throw new BackupError(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters`);
    const files: Record<string, string> = {};
    for (const name of BACKUP_FILES) {
      const file = this.file(name);
      if (file && fs.existsSync(file)) files[name] = fs.readFileSync(file).toString('base64');
    }
    if (!files['coordinator_backup.json']) throw new BackupError('There is no coordinator backup to download yet', 409);
    const at = this.now();
    const plain = Buffer.from(JSON.stringify({ format: 'synbee-coordinator-backup', version: 1, createdAt: at.toISOString(), files }));
    this.settings.set(this.downloadedKey, at.toISOString());
    const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return { filename: `synbee-coordinator-backup-${stamp}.synbee-backup`, data: encryptArchive(plain, passphrase) };
  }

  /**
   * Checks a downloaded archive and stages it for the supervisor, which puts it in place before Zigbee2MQTT next
   * starts. Returns the coordinator IEEE address the backup belongs to.
   */
  stageRestore(archive: Buffer, passphrase: string): { coordinatorIeee: string | null; files: string[] } {
    if (!this.z2mDataDir) throw new BackupError('Zigbee2MQTT is not part of this hub', 409);
    if (archive.length > MAX_ARCHIVE) throw new BackupError('The file is too large');
    const plain = decryptArchive(archive, passphrase);
    let content: { format?: unknown; files?: Record<string, unknown> };
    try {
      content = JSON.parse(plain.toString('utf8')) as typeof content;
    } catch {
      throw new BackupError('The backup is damaged');
    }
    if (content.format !== 'synbee-coordinator-backup' || !content.files || typeof content.files !== 'object') throw new BackupError('The backup is damaged');
    const names = Object.keys(content.files).filter((n) => BACKUP_FILES.includes(n));
    if (!names.includes('coordinator_backup.json')) throw new BackupError('The file holds no coordinator backup');
    const decoded = Object.fromEntries(names.map((n) => [n, Buffer.from(String(content.files![n]), 'base64')]));
    let ieee: string | null = null;
    try {
      const backup = JSON.parse(decoded['coordinator_backup.json']!.toString('utf8')) as { coordinator_ieee?: unknown };
      ieee = typeof backup.coordinator_ieee === 'string' ? `0x${backup.coordinator_ieee.toLowerCase().replace(/^0x/, '')}` : null;
    } catch {
      throw new BackupError('The coordinator backup in the file is damaged');
    }
    const staged = `${this.z2mDataDir}.restore`;
    const temp = `${staged}.tmp`;
    fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
    for (const [name, data] of Object.entries(decoded)) fs.writeFileSync(path.join(temp, name), data, { mode: 0o600 });
    fs.rmSync(staged, { recursive: true, force: true });
    fs.renameSync(temp, staged);
    return { coordinatorIeee: ieee, files: names };
  }
}

/**
 * Whether two IEEE addresses are the same coordinator. Zigbee2MQTT's backup file stores the address in the adapter's
 * byte order, which for Ember (and Z-Stack) is reversed: 0x1122334455667788 in the backup is 0x8877665544332211.
 */
export function sameIeee(a: string, b: string): boolean {
  const hex = (x: string) => x.toLowerCase().replace(/^0x/, '');
  const reversed = (x: string) => (hex(x).match(/../g) ?? []).reverse().join('');
  return hex(a) === hex(b) || reversed(a) === hex(b);
}
