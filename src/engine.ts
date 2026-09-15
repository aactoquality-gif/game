/**
 * Игровой движок — загрузка глав, навигация по сценам
 */

import type { Chapter, Scene, GameState } from './types'
import { saveProgress, loadProgress } from './storage'

/** Текущее состояние игры */
let currentState: GameState = {
  chapter: 1,
  sceneId: '',
  flags: {},
  savedAt: 0,
}

let currentChapter: Chapter | null = null

/** Коллбэк при смене сцены */
type SceneChangeCallback = (scene: Scene, sceneId: string) => void
let onSceneChange: SceneChangeCallback | null = null

/** Подписка на смену сцены */
export function onScene(callback: SceneChangeCallback): void {
  onSceneChange = callback
}

/** Инициализация движка — загрузить прогресс или начать сначала */
export async function initEngine(): Promise<void> {
  const saved = await loadProgress()

  if (saved) {
    currentState = saved
  } else {
    currentState = {
      chapter: 1,
      sceneId: '',
      flags: {},
      savedAt: 0,
    }
  }

  await loadChapter(currentState.chapter)
}

/** Загрузить главу */
async function loadChapter(num: number): Promise<void> {
  try {
    const response = await fetch(`/content/ru/ch${num}.json`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    currentChapter = await response.json() as Chapter

    // Если нет сохранённой сцены — начать с начала главы
    if (!currentState.sceneId || !currentChapter.scenes[currentState.sceneId]) {
      currentState.sceneId = currentChapter.startScene
    }

    navigateTo(currentState.sceneId)
  } catch (error) {
    console.error('Ошибка загрузки главы:', error)
    throw error
  }
}

/** Перейти к сцене */
export function navigateTo(sceneId: string): void {
  if (!currentChapter) return

  const scene = currentChapter.scenes[sceneId]
  if (!scene) {
    console.error(`Сцена "${sceneId}" не найдена`)
    return
  }

  currentState.sceneId = sceneId
  saveProgress(currentState)

  onSceneChange?.(scene, sceneId)
}

/** Сделать выбор по индексу */
export function makeChoice(choiceIndex: number): void {
  if (!currentChapter) return

  const scene = currentChapter.scenes[currentState.sceneId]
  if (!scene) return

  const choice = scene.choices[choiceIndex]
  if (!choice) return

  navigateTo(choice.next)
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
