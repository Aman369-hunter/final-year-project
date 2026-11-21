// AES-256-GCM encryption at rest for the genetics field (Section 5).
// Stored format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>.
// The owning document's id is bound as associated data, so a ciphertext copied
// onto a different case fails to decrypt.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

function key() {
  const k = Buffer.from(config.geneticsKey, 'base64');
  if (k.length !== 32) throw new Error('GENETICS_ENC_KEY must be 32 bytes, base64-encoded');
  return k;
}

export function assertEncryptionKey() {
  key();
}

export function encryptJson(value, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(String(aad)));
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptJson(stored, aad) {
  if (!stored) return null;
  const [version, iv, tag, ct] = stored.split(':');
  if (version !== 'v1') throw new Error('Unknown encrypted field version');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(String(aad)));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}
