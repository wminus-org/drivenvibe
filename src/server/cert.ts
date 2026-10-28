import { promises as fs } from 'node:fs';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { generate } from 'selfsigned';
import { HOME_DIR } from './paths.js';

const CERT_PATH = path.join(HOME_DIR, 'cert.pem');
const KEY_PATH = path.join(HOME_DIR, 'key.pem');

export interface TlsPair {
  cert: string;
  key: string;
}

/** Load existing cert+key, or generate (and persist) a fresh self-signed pair. */
export async function ensureSelfSignedCert(ipsAndHosts: string[]): Promise<TlsPair> {
  await fs.mkdir(HOME_DIR, { recursive: true });

  try {
    const [cert, key] = await Promise.all([
      fs.readFile(CERT_PATH, 'utf-8'),
      fs.readFile(KEY_PATH, 'utf-8'),
    ]);
    if (isUsablePair(cert, key, ipsAndHosts)) {
      await fs.chmod(KEY_PATH, 0o600).catch(() => {});
      return { cert, key };
    }
  } catch {
    // generate fresh
  }

  const attrs = [{ name: 'commonName', value: 'drivenvibe' }];
  const identities = Array.from(new Set(['localhost', ...ipsAndHosts]));
  const altNames: Array<{ type: 2; value: string } | { type: 7; ip: string }> = identities.map(
    (identity) => isIP(identity)
      ? { type: 7 as const, ip: identity }
      : { type: 2 as const, value: identity },
  );
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);
  const pems = await generate(attrs, {
    notAfterDate,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });

  await fs.writeFile(CERT_PATH, pems.cert);
  // 0o600: the private key must not be world-readable (no-op on Windows).
  await fs.writeFile(KEY_PATH, pems.private, { mode: 0o600 });
  await fs.chmod(KEY_PATH, 0o600).catch(() => {});
  return { cert: pems.cert, key: pems.private };
}

function isUsablePair(certPem: string, keyPem: string, identities: string[]): boolean {
  try {
    const cert = new X509Certificate(certPem);
    // Regenerate before expiry rather than surprising the user on their next
    // drive, and whenever a newly active LAN/ZeroTier address is missing.
    if (Date.parse(cert.validTo) <= Date.now() + 24 * 60 * 60 * 1000) return false;
    for (const identity of new Set(['localhost', ...identities])) {
      if (isIP(identity)) {
        if (!cert.checkIP(identity)) return false;
      } else if (!cert.checkHost(identity)) {
        return false;
      }
    }

    const keyPublic = createPublicKey(createPrivateKey(keyPem)).export({ type: 'spki', format: 'der' });
    const certPublic = cert.publicKey.export({ type: 'spki', format: 'der' });
    return keyPublic.equals(certPublic);
  } catch {
    return false;
  }
}
