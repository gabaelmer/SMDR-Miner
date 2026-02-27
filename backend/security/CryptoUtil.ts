import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

export class CryptoUtil {
  private readonly key?: Buffer;
  private readonly hashSalt: string;

  constructor(encryptionKey?: string, hashSalt = 'smdr-insight') {
    this.key = encryptionKey ? scryptSync(encryptionKey, 'smdr-insight', 32) : undefined;
    this.hashSalt = hashSalt;
  }

  isEnabled(): boolean {
    return Boolean(this.key);
  }

  encrypt(plain?: string): string | undefined {
    if (!plain) return plain;
    if (!this.key) return plain;

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(cipherText?: string): string | undefined {
    if (!cipherText) return cipherText;
    if (!this.key) return cipherText;

    const parts = cipherText.split(':');
    if (parts.length !== 3) return cipherText;

    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const payload = Buffer.from(parts[2], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
  }

  hashForIndex(value?: string): string | null {
    if (!value) return null;
    return createHash('sha256').update(`${this.hashSalt}:${value.toLowerCase().trim()}`).digest('hex');
  }
}
