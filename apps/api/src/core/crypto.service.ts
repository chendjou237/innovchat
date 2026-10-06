import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { env } from './config';

/** Derives a 32-byte key from a base64 value (or any string, hashed). */
function key32(raw: string): Buffer {
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : createHash('sha256').update(raw).digest();
}

/**
 * AES-256-GCM encryption for parent phone numbers and Meta secrets (NFR-12),
 * and keyed HMAC for searchable phone hashes (§4.3).
 * Ciphertext format: "v1:" + base64(iv | tag | ciphertext).
 */
@Injectable()
export class CryptoService {
  private readonly encKey = key32(env().ENCRYPTION_KEY);
  private readonly hashKey = key32(env().PHONE_HASH_KEY);

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  decrypt(payload: string): string {
    if (!payload.startsWith('v1:')) throw new Error('Format de chiffrement inconnu');
    const buf = Buffer.from(payload.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  phoneHash(e164: string): string {
    return createHmac('sha256', this.hashKey).update(e164).digest('hex');
  }
}
