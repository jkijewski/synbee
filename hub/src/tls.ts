import 'reflect-metadata';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as x509 from '@peculiar/x509';

// The hub's own TLS identity for the app listener (0021): an EC P-256 key and a long-lived self-signed
// certificate. The app pins the public key, so renewing the certificate keeps the same key.

x509.cryptoProvider.set(crypto.webcrypto as Crypto);

export interface TlsIdentity {
  key: string;
  cert: string;
  /** SHA-256 of the SubjectPublicKeyInfo, base64: what the app pins. */
  fingerprint: string;
  notAfter: Date;
}

const ALG = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const files = (dir: string) => ({ key: path.join(dir, 'tls-key.pem'), cert: path.join(dir, 'tls-cert.pem') });

export function spkiFingerprint(certPem: string): string {
  const cert = new crypto.X509Certificate(certPem);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(spki).digest('base64');
}

async function selfSign(keys: CryptoKeyPair, years = 10): Promise<string> {
  const now = new Date();
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: crypto.randomBytes(16).toString('hex'),
    name: 'CN=SynBee',
    notBefore: new Date(now.getTime() - 60_000),
    notAfter: new Date(now.getTime() + years * 365 * 24 * 3600 * 1000),
    signingAlgorithm: ALG,
    keys,
    extensions: [new x509.BasicConstraintsExtension(false, undefined, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true)],
  });
  return cert.toString('pem');
}

function load(dir: string): TlsIdentity | null {
  const f = files(dir);
  if (!fs.existsSync(f.key) || !fs.existsSync(f.cert)) return null;
  const cert = fs.readFileSync(f.cert, 'utf8');
  return { key: fs.readFileSync(f.key, 'utf8'), cert, fingerprint: spkiFingerprint(cert), notAfter: new Date(new crypto.X509Certificate(cert).validTo) };
}

async function create(dir: string): Promise<TlsIdentity> {
  const keys = (await crypto.webcrypto.subtle.generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pkcs8 = Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const key = `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  const cert = await selfSign(keys);
  const f = files(dir);
  fs.writeFileSync(f.key, key, { mode: 0o600 });
  fs.writeFileSync(f.cert, cert, { mode: 0o644 });
  return load(dir)!;
}

/** Loads the identity, creating it on first start. */
export async function ensureTlsIdentity(dir: string): Promise<TlsIdentity> {
  return load(dir) ?? create(dir);
}

/** Replaces the key pair; paired apps must pair again. */
export async function rotateTlsIdentity(dir: string): Promise<TlsIdentity> {
  const f = files(dir);
  fs.rmSync(f.key, { force: true });
  fs.rmSync(f.cert, { force: true });
  return create(dir);
}
