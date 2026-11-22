import type { Exhibit } from './assemblies'
import { exhibitNames } from './exhibit-names'

const key = 'petite-town.language'
let language: 'en' | 'ko' = 'en'
try {
  if (localStorage.getItem(key) === 'ko') language = 'ko'
} catch { /* Use English when storage is unavailable. */ }

const listeners = new Set<() => void>()
export const tr = (en: string, ko: string) => language === 'ko' ? ko : en
export const exhibitName = (item: Exhibit) => tr(exhibitNames[item.id] ?? item.id, item.name)
export function onLanguageChange(refresh: () => void) { listeners.add(refresh) }

export function setupLanguage() {
  const select = document.querySelector<HTMLSelectElement>('#language')!
  // Snapshot the English HTML once, before applying the saved preference.
  const translations: (() => void)[] = []
  for (const attribute of ['', 'aria-label', 'title']) {
    const source = attribute ? 'data-ko-' + attribute : 'data-ko'
    for (const element of Array.from(document.querySelectorAll('[' + source + ']'))) {
      const en = attribute ? element.getAttribute(attribute)! : element.textContent!
      const ko = element.getAttribute(source)!
      translations.push(() => {
        if (attribute) element.setAttribute(attribute, tr(en, ko))
        else element.textContent = tr(en, ko)
      })
    }
  }
  function refresh() {
    document.documentElement.lang = language
    select.value = language
    translations.forEach(update => update())
    listeners.forEach(update => update())
  }
  select.onchange = () => {
    language = select.value === 'ko' ? 'ko' : 'en'
    try { localStorage.setItem(key, language) } catch { /* Keep the session preference. */ }
    refresh()
  }
  refresh()
}
