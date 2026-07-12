#!/usr/bin/env node
// One-off importer: MySQL `article` dump -> bpad notes.
//
// Zero-knowledge: encryption happens here with YOUR password (derived to the
// data key exactly like the browser does). The password never leaves this
// process; only ciphertext is sent to the API.
//
// Usage:
//   node scripts/import-notes.mjs \
//     --dump ~/backup-12-07-2026.sql \
//     --url https://dev.bpad.pro \
//     --user <your-bpad-username> \
//     [--user-id 1] [--limit 0] [--dry-run]
//
// Password: set BPAD_PASS env var, or you'll be prompted (hidden).
//
// Prerequisites:
//   - The API must accept created_at on POST /notes (deploy that first).
//   - Verify your e-mail first (unverified accounts are capped at 10 notes).
//
// Run from the repo root so `hash-wasm` resolves (or adjust NODE path below).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'

// Resolve hash-wasm from the app's node_modules (script lives in repo/scripts).
const require = createRequire(new URL('../frontend/', import.meta.url))
const { argon2id } = require('hash-wasm')
const subtle = globalThis.crypto.subtle
const te = new TextEncoder()
const toB64 = (u8) => Buffer.from(u8).toString('base64')
const fromB64 = (b) => new Uint8Array(Buffer.from(b, 'base64'))

// ---- args ----
function arg(name, def = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return def
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const DUMP = arg('dump')
const BASE = (arg('url') || '').replace(/\/$/, '')
const USER = arg('user')
const USER_ID = String(arg('user-id', '1'))
const LIMIT = parseInt(arg('limit', '0'), 10) // 0 = all
const DRY = !!arg('dry-run')
if (!DUMP || (!DRY && (!BASE || !USER))) {
  console.error('Need --dump, and (for a real run) --url and --user. See header for usage.')
  process.exit(1)
}

// ---- parse the mysqldump `article` INSERT (handles backslash escapes) ----
function parseArticles(sql) {
  const marker = 'INSERT INTO `article` VALUES '
  const start = sql.indexOf(marker)
  if (start < 0) throw new Error('no `article` INSERT found in dump')
  let i = start + marker.length
  const rows = []
  const n = sql.length
  const esc = { n: '\n', r: '\r', t: '\t', 0: '\0', Z: '\x1a', b: '\b' }
  while (i < n) {
    while (i < n && sql[i] !== '(') { if (sql[i] === ';') return rows; i++ }
    if (i >= n) break
    i++
    const f = []
    while (i < n) {
      while (sql[i] === ' ') i++
      if (sql[i] === "'") {
        i++
        let s = ''
        while (i < n) {
          const c = sql[i]
          if (c === '\\') { const nx = sql[i + 1]; s += nx in esc ? esc[nx] : nx; i += 2; continue }
          if (c === "'") { i++; break }
          s += c; i++
        }
        f.push(s)
      } else {
        let s = ''
        while (i < n && sql[i] !== ',' && sql[i] !== ')') { s += sql[i]; i++ }
        s = s.trim(); f.push(s === 'NULL' ? null : s)
      }
      while (sql[i] === ' ') i++
      if (sql[i] === ',') { i++; continue }
      if (sql[i] === ')') { i++; break }
    }
    rows.push({ id: f[0], user_id: f[1], title: f[2], content: f[3], created: f[4], updated: f[5], deleted: f[6] })
    while (i < n && sql[i] !== '(' && sql[i] !== ';') i++
    if (sql[i] === ';') break
  }
  return rows
}

// ---- crypto (mirrors frontend/src/crypto.ts) ----
const ARGON2 = { parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32 }
async function hkdf(master, info) {
  const base = await subtle.importKey('raw', master, 'HKDF', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode(info) },
    base,
    256,
  )
  return new Uint8Array(bits)
}
async function deriveKeys(password, salt) {
  const master = await argon2id({ password, salt, ...ARGON2, outputType: 'binary' })
  return { encKey: await hkdf(master, 'bpad-enc'), authKey: await hkdf(master, 'bpad-auth') }
}
async function aesDecrypt(enc, keyBytes) {
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(enc.iv) }, key, fromB64(enc.ct)))
}
async function aesEncrypt(plaintext, keyBytes) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }
}

function promptHidden(q) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const stdout = process.stdout
    const onData = (ch) => { stdout.write('\x1b[2K\r' + q) }
    process.stdin.on('data', onData)
    rl.question(q, (a) => { process.stdin.off('data', onData); rl.close(); stdout.write('\n'); res(a) })
  })
}

async function main() {
  const rows = parseArticles(readFileSync(DUMP, 'utf8'))
  let notes = rows.filter((r) => r.deleted == null && r.user_id === USER_ID)
  if (LIMIT > 0) notes = notes.slice(0, LIMIT)
  console.log(`Parsed ${rows.length} rows; importing ${notes.length} (user_id=${USER_ID}, not deleted).`)

  if (DRY) {
    console.log('\n--dry-run: not contacting the API. Sample:')
    for (const r of notes.slice(0, 5)) {
      console.log(`  [${r.id}] ${JSON.stringify(r.title)}  ${r.content.length} chars  created ${r.created}`)
    }
    console.log('\nLooks right? Re-run without --dry-run (with --url and --user) to import.')
    return
  }

  const password = process.env.BPAD_PASS || (await promptHidden(`bpad password for ${USER}: `))

  // login (mirror frontend/src/authApi.ts login)
  const saltRes = await fetch(`${BASE}/api/auth/salt?username=${encodeURIComponent(USER)}`)
  const { salt } = await saltRes.json()
  const { encKey, authKey } = await deriveKeys(password, fromB64(salt))
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, authVerifier: toB64(authKey) }),
  })
  if (!loginRes.ok) { console.error('Login failed (wrong password?):', loginRes.status); process.exit(1) }
  const { token, wrappedDataKeyPw } = await loginRes.json()
  const dataKey = await aesDecrypt(wrappedDataKeyPw, encKey)
  console.log('Logged in, vault unlocked. Importing…\n')

  let ok = 0, fail = 0
  for (const [idx, r] of notes.entries()) {
    const payload = { title: r.title, content: r.content, url: null, tags: [] }
    const enc = await aesEncrypt(te.encode(JSON.stringify(payload)), dataKey)
    const created_at = String(r.created).replace(' ', 'T')
    try {
      const res = await fetch(`${BASE}/api/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body: JSON.stringify({ ...enc, created_at }),
      })
      if (res.ok) { ok++ } else {
        fail++
        const body = await res.text()
        console.error(`  FAIL [${r.id}] ${res.status}: ${body.slice(0, 120)}`)
        if (res.status === 403) { console.error('  → note limit hit — verify your e-mail first.'); break }
      }
    } catch (e) { fail++; console.error(`  FAIL [${r.id}] ${e.message}`) }
    if ((idx + 1) % 20 === 0) console.log(`  …${idx + 1}/${notes.length}`)
    await new Promise((s) => setTimeout(s, 40))
  }
  console.log(`\nDone. Imported ${ok}, failed ${fail}.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
