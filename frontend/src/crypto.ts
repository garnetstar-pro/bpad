// Klientská kryptografická vrstva pro zero-knowledge trezor.
// Používá jen prověřené primitivy: Argon2id (hash-wasm), HKDF + AES-256-GCM
// (Web Crypto). Heslo ani odvozené klíče nikdy neopouštějí prohlížeč.
import { argon2id } from 'hash-wasm'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// Argon2id parametry (laditelné dle výkonu zařízení).
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

// Web Crypto vyžaduje BufferSource nad ArrayBuffer (ne ArrayBufferLike/Shared).
// Zkopíruje bajty do čerstvého ArrayBufferu, ať typy i runtime sedí.
function buf(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(ab).set(bytes)
  return ab
}

// --- náhoda ---
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

export function generateSalt(): Uint8Array {
  return randomBytes(16)
}

export function generateDataKey(): Uint8Array {
  return randomBytes(32)
}

// Recovery kód: 160 bitů entropie, base32 (RFC 4648, bez matoucích znaků),
// seskupené po 4 (např. ABCD-EFGH-...). Zobrazí se jen jednou.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function generateRecoveryCode(): string {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5), 2)]
  return out.match(/.{1,4}/g)!.join('-')
}

// Normalizace recovery kódu při zadání (odstraní pomlčky/mezery, velká písmena).
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
  // Obaluje dataKey; nikdy neopouští klienta.
  encKey: Uint8Array
  // Důkaz identity vůči serveru (posílá se); z encKey ho nelze odvodit.
  authKey: Uint8Array
}

// Odvodí z hesla (nebo recovery kódu) dvojici klíčů. Deterministické pro
// stejný vstup + sůl.
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

// Obalení / odbalení náhodného dataKey klíčem odvozeným z hesla či recovery.
export async function wrapDataKey(dataKey: Uint8Array, wrappingKey: Uint8Array): Promise<Encrypted> {
  return encryptBytes(dataKey, wrappingKey)
}

export async function unwrapDataKey(wrapped: Encrypted, wrappingKey: Uint8Array): Promise<Uint8Array> {
  return decryptBytes(wrapped, wrappingKey)
}

// Šifrování / dešifrování JSON payloadu poznámky pomocí dataKey.
export async function encryptJSON(value: unknown, dataKey: Uint8Array): Promise<Encrypted> {
  return encryptBytes(textEncoder.encode(JSON.stringify(value)), dataKey)
}

export async function decryptJSON<T>(enc: Encrypted, dataKey: Uint8Array): Promise<T> {
  const bytes = await decryptBytes(enc, dataKey)
  return JSON.parse(textDecoder.decode(bytes)) as T
}
