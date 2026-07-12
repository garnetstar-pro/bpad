import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { en, type Dictionary } from './en'

export type Locale = 'en'
export type Params = Record<string, string | number>

const LOCALES: Record<Locale, Dictionary> = { en }
const STORAGE_KEY = 'bpad.locale'

export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[]
}

function isLocale(v: string | null): v is Locale {
  return v !== null && v in LOCALES
}

function detectLocale(): Locale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (isLocale(stored)) return stored
  const nav = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2) : 'en'
  return isLocale(nav) ? nav : 'en'
}

// Module-level active locale for the non-hook translate() (modules without React).
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

function resolve(locale: Locale, key: string, params?: Params): string {
  const s = lookup(LOCALES[locale], key)
  return s === undefined ? key : interpolate(s, params)
}

// Non-hook translation for plain modules (api.ts, authApi.ts, …).
export function translate(key: string, params?: Params): string {
  return resolve(activeLocale, key, params)
}

interface Ctx {
  t: (key: string, params?: Params) => string
  locale: Locale
  setLocale: (l: Locale) => void
}
const LanguageContext = createContext<Ctx | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const l = detectLocale()
    setActiveLocale(l)
    return l
  })

  const value = useMemo<Ctx>(
    () => ({
      locale,
      t: (key, params) => resolve(locale, key, params),
      setLocale: (l) => {
        setActiveLocale(l)
        try {
          localStorage.setItem(STORAGE_KEY, l)
        } catch {
          // localStorage unavailable – just keep it in memory
        }
        setLocaleState(l)
      },
    }),
    [locale],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useTranslation(): Ctx {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useTranslation must be used within LanguageProvider')
  return ctx
}
