/**
 * Контракт с сервером и клиент API. Вся новая сеть — только отсюда.
 *
 * Сейчас по-настоящему ходит в сеть только getConfig (статичный /config.json).
 * Баланс и входящие — на моках (api.mock.ts), пока нет эндпоинтов (шаги 8.x).
 * Типы ответов — это и есть контракт: сервер потом реализует ровно их.
 *
 * Деньги: клиент только показывает то, что прислал сервер. Никаких расчётов баланса здесь и выше.
 */

import { mockApi } from './api.mock'

// ---------------------------------------------------------------------------
// Удалённый конфиг: флаги включают части интерфейса без правки кода
// ---------------------------------------------------------------------------

export interface RemoteConfig {
  /** Версия формата файла */
  readonly version: number
  /** Валюты в хедере, «+», платные выборы — Г3 */
  readonly economy_enabled: boolean
  /** Вкладка «Магазин» и покупки — Г3 */
  readonly store_enabled: boolean
  /** Колокольчик и входящие уведомления — Г2 */
  readonly inbox_enabled: boolean
  /** Языки, для которых есть контент (переключатель языка показывает только их) */
  readonly languages: readonly string[]
}

/** Булевы флаги — их можно включить параметром ?ff= для просмотра (см. sync.ts) */
export const FLAG_KEYS = ['economy_enabled', 'store_enabled', 'inbox_enabled'] as const
export type FlagKey = (typeof FLAG_KEYS)[number]

/** Значения по умолчанию: игра работает и без файла конфига, всё новое выключено */
export const DEFAULT_CONFIG: RemoteConfig = {
  version: 1,
  economy_enabled: false,
  store_enabled: false,
  inbox_enabled: false,
  languages: ['ru'],
}

/** Разбор ответа: неизвестные поля игнорируются, поле неверного типа берётся из значений по умолчанию */
export function parseConfig(raw: unknown): RemoteConfig {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const bool = (key: FlagKey): boolean => (typeof src[key] === 'boolean' ? (src[key] as boolean) : DEFAULT_CONFIG[key])
  const languages = Array.isArray(src.languages) && src.languages.every((l) => typeof l === 'string') && src.languages.length > 0
  return {
    version: typeof src.version === 'number' ? src.version : DEFAULT_CONFIG.version,
    economy_enabled: bool('economy_enabled'),
    store_enabled: bool('store_enabled'),
    inbox_enabled: bool('inbox_enabled'),
    languages: languages ? (src.languages as string[]) : DEFAULT_CONFIG.languages,
  }
}

// ---------------------------------------------------------------------------
// Кошелёк. Коды валют постоянные: по ним сервер ведёт журнал начислений и списаний
// ---------------------------------------------------------------------------

export type CurrencyCode = 'nishtyak' | 'generic'

/** GET /api/wallet (шаг 8.x). Баланс = сумма записей журнала на сервере */
export interface WalletResponse {
  readonly balances: Readonly<Record<CurrencyCode, number>>
  /** Момент, на который посчитан баланс (мс) */
  readonly asOf: number
}

// ---------------------------------------------------------------------------
// Входящие (колокольчик). Не путать с «Пушем Опеки» — тот часть сюжета и живёт в главе
// ---------------------------------------------------------------------------

export type InboxItemType = 'episode' | 'reward' | 'system'

export interface InboxItem {
  readonly id: string
  readonly type: InboxItemType
  readonly title: string
  readonly body: string
  /** Куда ведёт тап: 'story:namertvo', 'shop' и т. п. Нет — просто читается */
  readonly deeplink?: string
  readonly createdAt: number
}

/** GET /api/inbox (шаг 8.x). Непрочитанные — те, что новее курсора readUntil */
export interface InboxResponse {
  readonly items: readonly InboxItem[]
  readonly readUntil: number
}

// ---------------------------------------------------------------------------
// Клиент
// ---------------------------------------------------------------------------

/** Загрузка JSON с ограничением по времени: медленная сеть не должна вешать интерфейс */
async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export interface Api {
  getConfig(): Promise<RemoteConfig>
  getWallet(): Promise<WalletResponse>
  getInbox(): Promise<InboxResponse>
}

export const api: Api = {
  getConfig: async () => parseConfig(await fetchJson('/config.json', 2500)),
  getWallet: () => mockApi.getWallet(), // шаг 8.x: GET /api/wallet
  getInbox: () => mockApi.getInbox(), // шаг 8.x: GET /api/inbox
}
