/**
 * Игровой движок — загрузка глав, навигация по экранам, выборы и скрытые счётчики
 */

import type { Chapter, Scene, GameState } from './types'
import { saveProgress, loadProgress } from './storage'
import { track, updateContext, resetRunCounters, getScreensInRun } from './analytics'

/** Чистое состояние для начала главы */
function freshState(chapter = 1): GameState {
  return { chapter, sceneId: '', flags: {}, counters: {}, picks: [], run: 1, savedAt: 0 }
}

/** Текущее состояние игры */
let currentState: GameState = freshState()

let currentChapter: Chapter | null = null

/** Коллбэк при смене экрана */
type SceneChangeCallback = (scene: Scene, sceneId: string) => void
let onSceneChange: SceneChangeCallback | null = null

/** Подписка на смену экрана */
export function onScene(callback: SceneChangeCallback): void {
  onSceneChange = callback
}

/** Инициализация движка — загрузить прогресс или начать сначала */
export async function initEngine(): Promise<void> {
  const saved = await loadProgress()

  // Старые сохранения могут не содержать новых полей (counters, picks, run) — дополняем
  currentState = saved ? { ...freshState(saved.chapter || 1), ...saved } : freshState()

  await loadChapter(currentState.chapter)
}

/** Загрузить главу */
async function loadChapter(num: number): Promise<void> {
  try {
    // no-cache: телефон каждый раз сверяется с сервером, чтобы не показывать старую версию главы
    const response = await fetch(`/content/ru/ch${num}.json`, { cache: 'no-cache' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    currentChapter = await response.json() as Chapter

    // Если нет сохранённого экрана (или глава изменилась) — начать с начала главы
    const resumed = !!currentState.sceneId && !!currentChapter.scenes[currentState.sceneId]
    if (!resumed) {
      currentState.sceneId = currentChapter.startScene
    }

    // Аналитика (как EpisodeStarted / EpisodeEnter в 7H):
    // episode_enter — каждое открытие; episode_start — только настоящий старт с первого экрана
    updateContext({ episode: num, run: currentState.run })
    track('episode_enter', { resumed })
    if (!resumed) track('episode_start')

    navigateTo(currentState.sceneId)
  } catch (error) {
    console.error('Ошибка загрузки главы:', error)
    throw error
  }
}

/** Перейти к экрану */
export function navigateTo(sceneId: string): void {
  if (!currentChapter) return

  const scene = currentChapter.scenes[sceneId]
  if (!scene) {
    console.error(`Экран "${sceneId}" не найден`)
    return
  }

  currentState.sceneId = sceneId
  saveProgress(currentState)

  // Аналитика: обновить текущий экран и отправить screen_view
  const kind = scene.kind ?? 'text'
  updateContext({ screen: sceneId })
  track('screen_view', { kind })

  // Если экран — конец эпизода, отправить episode_complete
  if (kind === 'end') {
    track('episode_complete', { screens_viewed: getScreensInRun() })
  }

  onSceneChange?.(scene, sceneId)
}

/** Текущий экран */
function currentScene(): Scene | null {
  return currentChapter?.scenes[currentState.sceneId] ?? null
}

/** Экран по ID — для предзагрузки картинок */
export function peekScene(sceneId: string): Scene | null {
  return currentChapter?.scenes[sceneId] ?? null
}

/** Перейти дальше по тапу (только для экранов без выбора) */
export function advance(): void {
  const scene = currentScene()
  if (!scene || scene.choices?.length || !scene.next) return
  navigateTo(scene.next)
}

/** Сделать выбор по индексу: записать счётчики и ID выбора, перейти дальше */
export function makeChoice(choiceIndex: number): void {
  const choice = currentScene()?.choices?.[choiceIndex]
  if (!choice) return

  if (choice.effects) {
    for (const [counter, delta] of Object.entries(choice.effects)) {
      currentState.counters[counter] = (currentState.counters[counter] ?? 0) + delta
    }
  }
  currentState.picks = [...currentState.picks, choice.id]

  // Аналитика: отправить choice_made перед переходом
  track('choice_made', {
    choice_id: choice.id,
    choice_type: choice.type ?? 'neutral',
    ...(choice.effects ? { effects: choice.effects } : {}),
  })

  navigateTo(choice.next)
}

/** Начать текущую главу заново (сбрасывает выборы и счётчики) */
export function restartChapter(): void {
  if (!currentChapter) return

  const nextRun = (currentState.run ?? 1) + 1
  currentState = freshState(currentState.chapter)
  currentState.run = nextRun

  // Аналитика: обновить run, сбросить счётчики экранов, отправить episode_start
  updateContext({ run: nextRun })
  resetRunCounters()
  track('episode_start')

  navigateTo(currentChapter.startScene)
}

/** Получить текущее состояние */
export function getState(): GameState {
  return { ...currentState }
}

/** Установить флаг */
export function setFlag(key: string, value: boolean): void {
  currentState.flags[key] = value
  saveProgress(currentState)
}

/** Проверить флаг */
export function getFlag(key: string): boolean {
  return currentState.flags[key] ?? false
}
