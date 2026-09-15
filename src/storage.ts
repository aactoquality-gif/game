/**
 * Хранение прогресса игрока
 *
 * Стратегия: Telegram CloudStorage = источник правды,
 *            localStorage = кэш для быстрого доступа
 */

import type { GameState } from './types'
import { tg } from './telegram'

const STORAGE_KEY = 'game_state'

/** Сохранить прогресс */
export function saveProgress(state: GameState): void {
  const data = JSON.stringify({ ...state, savedAt: Date.now() })

  // Кэш в localStorage
  try {
    localStorage.setItem(STORAGE_KEY, data)
  } catch {
    // localStorage может быть недоступен — игнорируем
  }

  // Основное хранение в Telegram CloudStorage
  if (tg?.CloudStorage) {
    tg.CloudStorage.setItem(STORAGE_KEY, data, (error) => {
      if (error) console.error('CloudStorage save error:', error)
    })
  }
}

/** Загрузить прогресс */
export async function loadProgress(): Promise<GameState | null> {
  // Пробуем Telegram CloudStorage (приоритет)
  if (tg?.CloudStorage) {
    const cloudState = await loadFromCloud()
    if (cloudState) {
      // Обновляем localStorage-кэш
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudState))
      } catch { /* ignore */ }
      return cloudState
    }
  }

  // Фоллбэк на localStorage
  return loadFromLocal()
}

/** Загрузить из CloudStorage */
function loadFromCloud(): Promise<GameState | null> {
  return new Promise((resolve) => {
    tg!.CloudStorage.getItem(STORAGE_KEY, (error, value) => {
      if (error || !value) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(value) as GameState)
      } catch {
        resolve(null)
      }
    })
  })
}

/** Загрузить из localStorage */
function loadFromLocal(): GameState | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return null
    return JSON.parse(data) as GameState
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
    tg.CloudStorage.removeItem(STORAGE_KEY)
  }
}
