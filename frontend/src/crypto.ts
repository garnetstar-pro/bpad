// Client-side cryptography layer for the zero-knowledge vault.
// Uses only vetted primitives: Argon2id (hash-wasm), HKDF + AES-256-GCM
// (Web Crypto). Neither the password nor the derived keys ever leave the browser.
import { argon2id } from 'hash-wasm'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Argon2id parameters (tunable to the device's performance).
const ARGON2 = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32 } as const

// --- base64 <-> bytes ---
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Web Crypto wants a BufferSource over an ArrayBuffer (not ArrayBufferLike/Shared).
// Copies the bytes into a fresh ArrayBuffer so both the types and the runtime line up.
function buf(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

// --- randomness ---
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function generateSalt(): Uint8Array {
  return randomBytes(16)
}

export function generateDataKey(): Uint8Array {
  return randomBytes(32)
}

// Recovery code: 160 bits of entropy, base32 (RFC 4648, no confusing chars),
// grouped in 4s (e.g. ABCD-EFGH-...). Shown only once.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{1,4}/g)!.join('-')
}

// Normalizes the recovery code on entry (strips dashes/spaces, uppercases).
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase()
}

// --- KDF ---
async function deriveMasterKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    parallelism: ARGON2.parallelism,
    iterations: ARGON2.iterations,
    memorySize: ARGON2.memorySize,
    hashLength: ARGON2.hashLength,
    outputType: 'binary',
  })
}

async function hkdf(keyMaterial: Uint8Array, info: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', buf(keyMaterial), 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: buf(textEncoder.encode(info)) },
    base,
    256,
  )
  return new Uint8Array(bits)
}

export interface DerivedKeys {
  // Wraps dataKey; never leaves the client.
  encKey: Uint8Array
  // Proof of identity sent to the server; authKey can't be derived from encKey.
  authKey: Uint8Array
}

// Derives a pair of keys from the password (or recovery code). Deterministic
// for the same input + salt.
export async function deriveKeys(password: string, salt: Uint8Array): Promise<DerivedKeys> {
  const master = await deriveMasterKey(password, salt)
  return {
    encKey: await hkdf(master, 'bpad-enc'),
    authKey: await hkdf(master, 'bpad-auth'),
  }
}

// --- AES-256-GCM ---
export interface Encrypted {
  iv: string // base64
  ct: string // base64
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptBytes(plaintext: Uint8Array, keyBytes: Uint8Array): Promise<Encrypted> {
  const iv = randomBytes(12)
  const key = await importAesKey(keyBytes)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(plaintext))
  return { iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) }
}

export async function decryptBytes(enc: Encrypted, keyBytes: Uint8Array): Promise<Uint8Array> {
  const key = await importAesKey(keyBytes)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(fromBase64(enc.iv)) },
    key,
    buf(fromBase64(enc.ct)),
  )
  return new Uint8Array(pt)
}

// Wrap / unwrap the random dataKey with a key derived from the password or recovery code.
export async function wrapDataKey(dataKey: Uint8Array, wrappingKey: Uint8Array): Promise<Encrypted> {
  return encryptBytes(dataKey, wrappingKey)
}

export async function unwrapDataKey(wrapped: Encrypted, wrappingKey: Uint8Array): Promise<Uint8Array> {
  return decryptBytes(wrapped, wrappingKey)
}

// Encrypt / decrypt a note's JSON payload using the dataKey.
export async function encryptJSON(value: unknown, dataKey: Uint8Array): Promise<Encrypted> {
  return encryptBytes(textEncoder.encode(JSON.stringify(value)), dataKey)
}

export async function decryptJSON<T>(enc: Encrypted, dataKey: Uint8Array): Promise<T> {
  const bytes = await decryptBytes(enc, dataKey)
  return JSON.parse(textDecoder.decode(bytes)) as T
}
