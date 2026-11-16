import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const;
const MAX_N = 1 << 20;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 512;

/**
 * Hash a password using scrypt with a unique random 16-byte salt.
 * Format: scrypt:<N>:<r>:<p>:<salt_hex>:<key_hex>
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join(':');
}

/**
 * Verify a plaintext password against a stored scrypt hash in constant time.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nRaw, rRaw, pRaw, saltHex, keyHex] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  const hex = /^[0-9a-f]+$/i;
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0) || N > MAX_N) return false;
  if (!hex.test(saltHex) || !hex.test(keyHex) || keyHex.length % 2 !== 0) return false;
  const expected = Buffer.from(keyHex, 'hex');
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N, r, p });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Generate a 32-byte cryptographically secure random session token and its SHA-256 hash.
 * The raw token is returned for client delivery (e.g. cookie header); only the SHA-256
 * hash is persisted to the database.
 */
export function generateSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Compute the SHA-256 digest of a raw session token.
 */
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Validate password length and format constraints.
 * Returns null if valid, or a descriptive error string if invalid.
 */
export function validatePasswordShape(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password must be text';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  if (password.trim() !== password) return 'Password cannot start or end with whitespace';
  if (/[\r\n]/.test(password)) return 'Password cannot contain line breaks';
  return null;
}

