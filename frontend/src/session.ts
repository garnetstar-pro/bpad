// Session žije JEN v paměti (žádné localStorage/sessionStorage): token pro API
// a dataKey pro šifrování poznámek. Zavření karty = odhlášení.
let token: string | null = null
let dataKey: Uint8Array | null = null

export function setSession(newToken: string, newDataKey: Uint8Array): void {
  token = newToken
  dataKey = newDataKey
}

export function clearSession(): void {
  token = null
  dataKey = null
}

export function getToken(): string | null {
  return token
}

export function getDataKey(): Uint8Array | null {
  return dataKey
}
