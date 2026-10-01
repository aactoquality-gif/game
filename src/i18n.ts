/**
 * Локализация интерфейса: t('ключ', { подстановки }).
 *
 *   t('menu.title')                                  → «Личные дела»
 *   t('common.caseNo', { no: '01' })                 → «Дело № 01»
 *   t('ключ', { count: 3 })                          → форма по числу, если строка задана формами
 *                                                      { one, few, many, other }: «3 уведомления»
 *
 * Сейчас есть только русский: контент историй тоже только на русском, а язык интерфейса
 * не должен расходиться с языком текста. Новый язык = файл src/locales/<код>.ts с полным
 * переводом (тип Messages не даст пропустить ключ) + строка в DICTIONARIES. Выбор языка
 * игроком и подгрузка словаря по требованию — шаг 5.2.
 *
 * Не через t(): контент (главы, каталог) и сообщения для разработчика (console, Error).
 */

import { ru } from './locales/ru'

type PluralForms = { readonly one: string; readonly few?: string; readonly many?: string; readonly other: string }
type Message = string | PluralForms

export type MessageKey = keyof typeof ru
export type Messages = Readonly<Record<MessageKey, Message>>
export type Locale = 'ru'
export type Params = Readonly<Record<string, string | number>>

const DICTIONARIES: Readonly<Record<Locale, Messages>> = { ru }

let locale: Locale = 'ru'
let plural = makePluralRules(locale)

function makePluralRules(code: string): Intl.PluralRules | null {
  try {
    return new Intl.PluralRules(code)
  } catch {
    return null // очень старый WebView без Intl — берём форму other
  }
}

export function getLocale(): Locale {
  return locale
}

export function setLocale(next: Locale): void {
  if (!(next in DICTIONARIES)) return
  locale = next
  plural = makePluralRules(next)
  document.documentElement.lang = next
}

function pick(message: Message, params?: Params): string {
  if (typeof message === 'string') return message
  const count = Number(params?.count)
  const form = plural && Number.isFinite(count) ? (plural.select(count) as keyof PluralForms) : 'other'
  return message[form] ?? message.other
}

export function t(key: MessageKey, params?: Params): string {
  const message = DICTIONARIES[locale][key] ?? ru[key]
  if (message === undefined) {
    console.error(`i18n: нет строки «${key}»`)
    return key
  }
  const text = pick(message, params)
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole))
}
