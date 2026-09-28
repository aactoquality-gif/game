/**
 * Хранение прогресса игрока
 *
 * Стратегия «сначала на устройстве»:
 *   - сохранение: сразу в localStorage, затем в фоне в Telegram CloudStorage;
 *   - загрузка: читаем обе копии, облако ждём не дольше CLOUD_TIMEOUT_MS,
 *     и берём более свежую по savedAt.
 *
 * Почему так: при замедлении Telegram ответ облака может задерживаться,
 * а игрок не должен смотреть на экран загрузки. Если облако не успело —
 * играем с копии на телефоне.
 */

import type { GameState } from './types'
import { tg } from './telegram'

const STORAGE_KEY = 'game_state'

/** Сколько ждать ответа облака при запуске игры, мс */
const CLOUD_TIMEOUT_MS = 2500

/** Сохранить прогресс */
export function saveProgress(state: GameState): void {
  const data = JSON.stringify({ ...state, savedAt: Date.now() })

  // Сначала на устройство — мгновенно
  try {
    localStorage.setItem(STORAGE_KEY, data)
  } catch {
    // localStorage может быть недоступен — игнорируем
  }

  // Затем в Telegram CloudStorage — в фоне, не ждём ответа
  if (tg?.CloudStorage) {
    try {
      tg.CloudStorage.setItem(STORAGE_KEY, data, (error) => {
        if (error) console.error('CloudStorage save error:', error)
      })
    } catch {
      // CloudStorage может быть недоступен в старых версиях — игнорируем
    }
  }
}

/** Загрузить прогресс: более свежая из двух копий */
export async function loadProgress(): Promise<GameState | null> {
  const local = loadFromLocal()
  const cloud = await loadFromCloudWithTimeout()
  return pickFresher(local, cloud)
}

/** Выбрать более свежую копию; при равенстве — локальную */
function pickFresher(local: GameState | null, cloud: GameState | null): GameState | null {
  if (!local) return cloud
  if (!cloud) return local
  return (cloud.savedAt || 0) > (local.savedAt || 0) ? cloud : local
}

/** Загрузить из CloudStorage, но не дольше CLOUD_TIMEOUT_MS */
async function loadFromCloudWithTimeout(): Promise<GameState | null> {
  if (!tg?.CloudStorage) return null

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`CloudStorage не ответил за ${CLOUD_TIMEOUT_MS} мс — берём копию с устройства`)
      resolve(null)
    }, CLOUD_TIMEOUT_MS)
  })

  try {
    return await Promise.race([loadFromCloud(), timeout])
  } catch {
    // CloudStorage недоступен (например, старая версия Telegram)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Загрузить из CloudStorage */
function loadFromCloud(): Promise<GameState | null> {
  return new Promise((resolve) => {
    tg!.CloudStorage.getItem(STORAGE_KEY, (error, value) => {
      if (error || !value) {
        resolve(null)
        return
      }
      resolve(parseState(value))
    })
  })
}

/** Загрузить из localStorage */
function loadFromLocal(): GameState | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return null
    return parseState(data)
  } catch {
    return null
  }
}

/** Разобрать сохранение; повреждённое — считаем отсутствующим */
function parseState(raw: string): GameState | null {
  try {
    const state = JSON.parse(raw) as GameState
    if (!state || typeof state !== 'object' || typeof state.sceneId !== 'string') return null
    return state
  } catch {
    return null
  }
}

/** Сбросить прогресс */
export function resetProgress(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }

  if (tg?.CloudStorage) {
    try {
      tg.CloudStorage.removeItem(STORAGE_KEY)
    } catch { /* ignore */ }
  }
}
