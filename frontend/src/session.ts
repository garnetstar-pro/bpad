// The session lives ONLY in memory (no localStorage): token for the API,
// dataKey for encryption, authKey for re-login, username for the cache. Token
// can be null = unlocked offline (read-only from the local cache). Closing
// the tab = logout.
import { clearImageUrlCache } from './images'

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
  clearImageUrlCache()
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

// Unlocked but with no token = offline mode → read-only.
export function isOfflineReadOnly(): boolean {
  return dataKey !== null && token === null
}
