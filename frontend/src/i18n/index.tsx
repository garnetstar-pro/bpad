import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import {
  resolve,
  translate,
  setActiveLocale,
  detectLocale,
  availableLocales,
  STORAGE_KEY,
  type Locale,
  type Params,
} from './translate'

// Re-export the React-free core so components can keep importing from './i18n'.
export { translate, setActiveLocale, availableLocales, type Locale, type Params }

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
