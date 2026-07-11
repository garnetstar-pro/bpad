// Session žije JEN v paměti (žádné localStorage/sessionStorage): token pro API,
// dataKey pro šifrování poznámek a authKey pro re-login (biometrika). Zavření
// karty = odhlášení.
let token: string | null = null
let dataKey: Uint8Array | null = null
let authKey: Uint8Array | null = null

export function setSession(newToken: string, newDataKey: Uint8Array, newAuthKey: Uint8Array): void {
  token = newToken
  dataKey = newDataKey
  authKey = newAuthKey
}

export function clearSession(): void {
  token = null
  dataKey = null
  authKey = null
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
