// Session žije JEN v paměti (žádné localStorage): token pro API, dataKey pro
// šifrování, authKey pro re-login, username pro cache. Token může být null =
// offline odemčeno (jen čtení z lokální cache). Zavření karty = odhlášení.
let token: string | null = null
let dataKey: Uint8Array | null = null
let authKey: Uint8Array | null = null
let username: string | null = null

export function setSession(
  newToken: string | null,
  newDataKey: Uint8Array,
  newAuthKey: Uint8Array,
  newUsername: string,
): void {
  token = newToken
  dataKey = newDataKey
  authKey = newAuthKey
  username = newUsername
}

export function clearSession(): void {
  token = null
  dataKey = null
  authKey = null
  username = null
}

export function getToken(): string | null {
  return token
}

export function getDataKey(): Uint8Array | null {
  return dataKey
}

export function getAuthKey(): Uint8Array | null {
  return authKey
}

export function getUsername(): string | null {
  return username
}

// Odemčeno, ale bez tokenu = offline režim → jen čtení.
export function isOfflineReadOnly(): boolean {
  return dataKey !== null && token === null
}
