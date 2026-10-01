/**
 * Загрузка данных в состояние: сеть (api.ts) → store. Компоненты только подписываются на store.
 *
 * Порядок при запуске: конфиг → по его флагам баланс и входящие. Ничего из этого не блокирует
 * первый экран: игра стартует сразу, данные догружаются, флаги по умолчанию выключены.
 *
 * Просмотр выключенных частей без правки конфига: ?ff=economy_enabled,inbox_enabled
 * Флаги управляют только интерфейсом — всё, что связано с деньгами, сервер проверяет сам.
 */

import { api, DEFAULT_CONFIG, FLAG_KEYS, type FlagKey, type RemoteConfig } from './api'
import { store } from './store'

/** Флаги, включённые параметром ?ff= */
function urlOverrides(): FlagKey[] {
  const raw = new URLSearchParams(location.search).get('ff') ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is FlagKey => (FLAG_KEYS as readonly string[]).includes(s))
}

function applyOverrides(config: RemoteConfig, overrides: FlagKey[]): RemoteConfig {
  const next: { -readonly [K in keyof RemoteConfig]: RemoteConfig[K] } = { ...config }
  for (const key of overrides) next[key] = true
  return next
}

export async function syncConfig(): Promise<void> {
  const overrides = urlOverrides()
  try {
    const remote = await api.getConfig()
    store.patch('config', { ...applyOverrides(remote, overrides), status: 'ready', overrides })
  } catch (error) {
    // Нет файла или медленная сеть — работаем на значениях по умолчанию, это не ошибка игры
    console.warn('Конфиг недоступен, работают значения по умолчанию:', error)
    store.patch('config', { ...applyOverrides(DEFAULT_CONFIG, overrides), status: 'error', overrides })
  }
}

export async function syncWallet(): Promise<void> {
  store.patch('wallet', { status: 'loading' })
  try {
    const { balances, asOf } = await api.getWallet()
    store.patch('wallet', { nishtyak: balances.nishtyak, generic: balances.generic, status: 'ready', syncedAt: asOf })
  } catch (error) {
    console.warn('Баланс не загрузился:', error)
    store.patch('wallet', { status: 'error' }) // прошлые значения остаются — интерфейс покажет их как устаревшие
  }
}

export async function syncInbox(): Promise<void> {
  store.patch('inbox', { status: 'loading' })
  try {
    const { items, readUntil } = await api.getInbox()
    store.patch('inbox', { items, unread: items.filter((i) => i.createdAt > readUntil).length, status: 'ready' })
  } catch (error) {
    console.warn('Входящие не загрузились:', error)
    store.patch('inbox', { status: 'error' })
  }
}

/** Запуск: не ждать — первый экран не зависит от этих данных */
export async function startSync(): Promise<void> {
  await syncConfig()
  const { config } = store.get()
  const jobs: Promise<void>[] = []
  if (config.economy_enabled) jobs.push(syncWallet())
  if (config.inbox_enabled) jobs.push(syncInbox())
  await Promise.all(jobs)
}
