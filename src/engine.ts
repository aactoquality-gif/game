/**
 * Игровой движок: каталог историй, сохранение по историям, открытие эпизода,
 * навигация по экранам, выборы и скрытые счётчики.
 *
 * Счётчики копятся через весь сезон; «Начать эпизод сначала» возвращает их
 * к значениям на старте эпизода.
 */

import type { Catalog, Chapter, Scene, SaveData, StoryMeta, StoryProgress, TextSize, EpisodeMeta } from './types'
import { saveProgress, loadProgress, emptySave, emptyProgress } from './storage'
import { track, updateContext, resetRunCounters, getScreensInRun } from './analytics'

const CONTENT_BASE = '/content/ru/'

let catalog: Catalog | null = null
let save: SaveData = emptySave()
/** Игрок здесь впервые (сохранения не было) */
let firstLaunch = false

/** Открытый эпизод */
let current: { storyId: string; episode: number; chapter: Chapter } | null = null
const chapterCache = new Map<string, Chapter>()

type SceneChangeCallback = (scene: Scene, sceneId: string) => void
let onSceneChange: SceneChangeCallback | null = null

export function onScene(callback: SceneChangeCallback): void {
  onSceneChange = callback
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------

export async function initEngine(): Promise<void> {
  const [saved, cat] = await Promise.all([loadProgress(), fetchJson<Catalog>('catalog.json')])
  catalog = cat
  firstLaunch = !saved
  save = saved ?? emptySave()
}

async function fetchJson<T>(file: string): Promise<T> {
  // no-cache: телефон каждый раз сверяется с сервером, чтобы не показывать старую версию
  const response = await fetch(CONTENT_BASE + file, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`HTTP ${response.status} ${file}`)
  return (await response.json()) as T
}

// ---------------------------------------------------------------------------
// Геттеры
// ---------------------------------------------------------------------------

export function getCatalog(): Catalog {
  if (!catalog) throw new Error('Каталог не загружен')
  return catalog
}

export function isFirstLaunch(): boolean {
  return firstLaunch
}

export function getStory(id: string): StoryMeta | undefined {
  return catalog?.stories.find((s) => s.id === id)
}

export function getProgress(storyId: string): StoryProgress | null {
  return save.stories[storyId] ?? null
}

export function getLastStoryId(): string | null {
  return save.last && getStory(save.last) ? save.last : null
}

export function getTextSize(): TextSize {
  return save.settings.textSize
}

export function setTextSize(size: TextSize): void {
  save.settings.textSize = size
  persist()
}

/** Эпизод, который логично открыть следующим: текущий недочитанный или первый непрочитанный вышедший */
export function nextEpisodeFor(storyId: string): { meta: EpisodeMeta; state: 'start' | 'continue' } | null {
  const story = getStory(storyId)
  if (!story) return null
  const p = getProgress(storyId)
  const released = story.episodes.filter((e) => e.status === 'available' && e.file)

  if (p && p.sceneId && !p.completed.includes(p.episode)) {
    const meta = released.find((e) => e.n === p.episode)
    if (meta) return { meta, state: 'continue' }
  }
  const unread = released.find((e) => !p?.completed.includes(e.n))
  return unread ? { meta: unread, state: 'start' } : null
}

export function currentInfo(): { storyId: string; episode: number; title: string } | null {
  return current ? { storyId: current.storyId, episode: current.episode, title: current.chapter.title } : null
}

export function peekScene(sceneId: string): Scene | null {
  return current?.chapter.scenes[sceneId] ?? null
}

function currentProgress(): StoryProgress | null {
  return current ? save.stories[current.storyId] ?? null : null
}

function currentScene(): Scene | null {
  const p = currentProgress()
  return p && current ? current.chapter.scenes[p.sceneId] ?? null : null
}

// ---------------------------------------------------------------------------
// Эпизод
// ---------------------------------------------------------------------------

/**
 * Открыть эпизод. Если он уже начат — продолжить с сохранённого экрана.
 * restart: true — начать эпизод заново (счётчики — как на старте эпизода).
 */
export async function openEpisode(storyId: string, n: number, opts: { restart?: boolean } = {}): Promise<void> {
  const meta = getStory(storyId)?.episodes.find((e) => e.n === n)
  if (!meta?.file) throw new Error(`Эпизод ${storyId}/${n} не вышел`)

  let chapter = chapterCache.get(meta.file)
  if (!chapter) {
    chapter = await fetchJson<Chapter>(meta.file)
    chapterCache.set(meta.file, chapter)
  }

  const p = save.stories[storyId] ?? emptyProgress(n)
  save.stories[storyId] = p
  save.last = storyId
  current = { storyId, episode: n, chapter }

  const sameEpisode = p.episode === n && !!p.sceneId && !!chapter.scenes[p.sceneId]

  if (opts.restart && sameEpisode) {
    beginRun(p, chapter, p.run + 1, { restart: true, enter: true })
  } else if (!sameEpisode) {
    // Новый эпизод: снимок счётчиков на старте.
    // Ограничение: перечитывание более раннего эпизода (когда выйдет эпизод 2) начнёт с текущих
    // счётчиков сезона — снимки по каждому эпизоду добавить вместе с эпизодом 2.
    const replay = p.completed.includes(n)
    p.episode = n
    p.startCounters = { ...p.counters }
    p.startPicks = [...p.picks]
    beginRun(p, chapter, replay ? p.run + 1 : 1, { restart: false, enter: true })
  } else {
    // Продолжаем с сохранённого экрана
    updateContext({ story: storyId, episode: n, run: p.run, screen: '', inEpisode: true })
    resetRunCounters()
    track('episode_enter', { resumed: true })
    navigateTo(p.sceneId, { resume: true })
    return
  }

  navigateTo(chapter.startScene)
}

/** Начать прохождение эпизода с первого экрана */
function beginRun(p: StoryProgress, chapter: Chapter, run: number, opts: { restart: boolean; enter: boolean }): void {
  if (opts.restart) {
    p.counters = { ...p.startCounters }
    p.picks = [...p.startPicks]
  }
  p.run = run
  p.sceneId = chapter.startScene
  p.pct = 0
  // screen: '' — чтобы episode_start не унаследовал экран конца прошлого прохождения
  updateContext({ story: current!.storyId, episode: current!.episode, run, screen: '', inEpisode: true })
  resetRunCounters()
  if (opts.enter) track('episode_enter', { resumed: false })
  track('episode_start')
}

/** Перейти к экрану. resume — показ сохранённого экрана при возврате (без повторных событий конца) */
export function navigateTo(sceneId: string, opts: { resume?: boolean } = {}): void {
  const p = currentProgress()
  if (!current || !p) return

  const scene = current.chapter.scenes[sceneId]
  if (!scene) {
    console.error(`Экран "${sceneId}" не найден`)
    return
  }

  const kind = scene.kind ?? 'text'
  p.sceneId = sceneId
  p.pct = scenePct(current.chapter, sceneId)
  if (kind === 'end' && !p.completed.includes(current.episode)) p.completed = [...p.completed, current.episode]
  p.updatedAt = Date.now()
  persist()

  updateContext({ screen: sceneId })
  track('screen_view', { kind })
  if (kind === 'end' && !opts.resume) {
    track('episode_complete', { screens_viewed: getScreensInRun() })
  }

  onSceneChange?.(scene, sceneId)
}

/** Процент прочитанного — по порядку экранов в файле эпизода */
function scenePct(chapter: Chapter, sceneId: string): number {
  const ids = Object.keys(chapter.scenes)
  if (chapter.scenes[sceneId]?.kind === 'end') return 100
  const i = ids.indexOf(sceneId)
  return ids.length > 1 && i >= 0 ? Math.min(99, Math.round((i / (ids.length - 1)) * 100)) : 0
}

/** Дальше по тапу (только для экранов без выбора) */
export function advance(): void {
  const scene = currentScene()
  if (!scene || scene.choices?.length || !scene.next) return
  navigateTo(scene.next)
}

/** Сделать выбор: записать счётчики и ID выбора, перейти дальше */
export function makeChoice(choiceIndex: number): void {
  const p = currentProgress()
  const choice = currentScene()?.choices?.[choiceIndex]
  if (!p || !choice) return

  if (choice.effects) {
    for (const [counter, delta] of Object.entries(choice.effects)) {
      p.counters[counter] = (p.counters[counter] ?? 0) + delta
    }
  }
  p.picks = [...p.picks, choice.id]

  track('choice_made', {
    choice_id: choice.id,
    choice_type: choice.type ?? 'neutral',
    ...(choice.effects ? { effects: choice.effects } : {}),
    ...(choice.price ? { price: choice.price } : {}),
  })

  navigateTo(choice.next)
}

/** Начать открытый эпизод заново */
export function restartEpisode(): void {
  const p = currentProgress()
  if (!current || !p) return
  beginRun(p, current.chapter, p.run + 1, { restart: true, enter: false })
  navigateTo(current.chapter.startScene)
}

/** Выйти из чтения (в историю или меню). Прогресс уже сохранён на каждом экране */
export function closeEpisode(): void {
  if (!current) return
  track('episode_exit', { screens_viewed: getScreensInRun(), reason: 'menu' })
  updateContext({ inEpisode: false, screen: '' })
  current = null
}

function persist(): void {
  saveProgress(save)
}
