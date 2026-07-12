// React-free core of the i18n layer: the dictionary lookup, interpolation and
// the non-hook translate(). Kept separate from index.tsx (Provider + hooks) so
// plain modules AND Web Workers can translate without pulling React into their
// bundle — importing React into powWorker.ts broke the worker.
import { en, type Dictionary } from './en'

export type Locale = 'en'
export type Params = Record<string, string | number>

const LOCALES: Record<Locale, Dictionary> = { en }
export const STORAGE_KEY = 'bpad.locale'

export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[]
}

export function isLocale(v: string | null): v is Locale {
  return v !== null && v in LOCALES
}

export function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (isLocale(stored)) return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en'
  return isLocale(nav) ? nav : 'en'
}

// Module-level active locale for the non-hook translate() (modules/workers).
let activeLocale: Locale = 'en'
export function setActiveLocale(l: Locale): void {
  activeLocale = l
}

function lookup(dict: Dictionary, key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[part]
  }
  return typeof node === 'string' ? node : undefined
}

function interpolate(s: string, params?: Params): string {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
}

export function resolve(locale: Locale, key: string, params?: Params): string {
  const s = lookup(LOCALES[locale], key)
  return s === undefined ? key : interpolate(s, params)
}

// Non-hook translation for plain modules (api.ts, authApi.ts, pow worker, …).
export function translate(key: string, params?: Params): string {
  return resolve(activeLocale, key, params)
}
