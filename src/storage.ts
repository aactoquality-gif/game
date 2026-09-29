/**
 * Хранение прогресса игрока
 *
 * Стратегия «сначала на устройстве»:
 *   - сохранение: сразу в localStorage, затем в фоне в Telegram CloudStorage;
 *   - загрузка: читаем обе копии, облако ждём не дольше CLOUD_TIMEOUT_MS,
 *     и берём более свежую по savedAt.
 *
 * Формат v2 — по историям (SaveData). Старое сохранение v1 (одна глава)
 * переносится в историю «Намертво» автоматически.
 */

import type { SaveData, StoryProgress } from './types'
import { tg, cloudStorageSupported } from './telegram'

const STORAGE_KEY = 'game_state'

/** Сколько ждать ответа облака при запуске игры, мс */
const CLOUD_TIMEOUT_MS = 2500

/** История, в которую переносится сохранение v1 */
const LEGACY_STORY = 'namertvo'

export function emptySave(): SaveData {
  return { v: 2, last: null, stories: {}, settings: { textSize: 'm' }, savedAt: 0 }
}

export function emptyProgress(episode = 1): StoryProgress {
  return {
    episode,
    sceneId: '',
    counters: {},
    picks: [],
    run: 1,
    completed: [],
    startCounters: {},
    startPicks: [],
    pct: 0,
    updatedAt: 0,
  }
}

/** Сохранить прогресс */
export function saveProgress(save: SaveData): void {
  const data = JSON.stringify({ ...save, savedAt: Date.now() })

  try {
    localStorage.setItem(STORAGE_KEY, data)
  } catch {
    // localStorage может быть недоступен — игнорируем
  }

  if (cloudStorageSupported) {
    try {
      tg!.CloudStorage.setItem(STORAGE_KEY, data, (error) => {
        if (error) console.error('CloudStorage save error:', error)
      })
    } catch {
      // Сбой облака не должен ломать игру — копия на устройстве уже записана
    }
  }
}

/** Загрузить прогресс: более свежая из двух копий. null — игрок здесь впервые */
export async function loadProgress(): Promise<SaveData | null> {
  const local = loadFromLocal()
  const cloud = await loadFromCloudWithTimeout()
  return pickFresher(local, cloud)
}

function pickFresher(local: SaveData | null, cloud: SaveData | null): SaveData | null {
  if (!local) return cloud
  if (!cloud) return local
  return (cloud.savedAt || 0) > (local.savedAt || 0) ? cloud : local
}

async function loadFromCloudWithTimeout(): Promise<SaveData | null> {
  if (!cloudStorageSupported) return null

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
    return null
  } finally {
    clearTimeout(timer)
  }
}

function loadFromCloud(): Promise<SaveData | null> {
  return new Promise((resolve) => {
    tg!.CloudStorage.getItem(STORAGE_KEY, (error, value) => {
      if (error || !value) {
        resolve(null)
        return
      }
      resolve(parseSave(value))
    })
  })
}

function loadFromLocal(): SaveData | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    return data ? parseSave(data) : null
  } catch {
    return null
  }
}

/** Разобрать сохранение (v2 или старое v1); повреждённое — считаем отсутствующим */
export function parseSave(raw: string): SaveData | null {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>

  if (o.v === 2 && o.stories && typeof o.stories === 'object') {
    const base = emptySave()
    const stories: Record<string, StoryProgress> = {}
    for (const [id, p] of Object.entries(o.stories as Record<string, Partial<StoryProgress>>)) {
      if (p && typeof p === 'object') stories[id] = { ...emptyProgress(), ...p }
    }
    const settings = (o.settings ?? {}) as Partial<SaveData['settings']>
    return {
      ...base,
      last: typeof o.last === 'string' ? o.last : null,
      stories,
      settings: { textSize: settings.textSize === 's' || settings.textSize === 'l' ? settings.textSize : 'm' },
      savedAt: Number(o.savedAt) || 0,
    }
  }

  // v1: { chapter, sceneId, counters, picks, run, savedAt }
  if (typeof o.sceneId === 'string') {
    const episode = Number(o.chapter) || 1
    const counters = (o.counters ?? {}) as Record<string, number>
    const picks = Array.isArray(o.picks) ? (o.picks as string[]) : []
    const onEnd = /_end$/.test(o.sceneId)
    const progress: StoryProgress = {
      ...emptyProgress(episode),
      sceneId: o.sceneId,
      counters,
      picks,
      run: Number(o.run) || 1,
      completed: onEnd ? [episode] : [],
      pct: onEnd ? 100 : 0,
      updatedAt: Number(o.savedAt) || 0,
    }
    return { ...emptySave(), last: LEGACY_STORY, stories: { [LEGACY_STORY]: progress }, savedAt: Number(o.savedAt) || 0 }
  }

  return null
}
