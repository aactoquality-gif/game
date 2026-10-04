/**
 * Фоновая музыка — один трек по кругу, стандартный HTMLAudioElement, без зависимостей.
 *
 * — Трек не грузится до первого касания: первый экран не ждёт сеть (бюджет ≤ 3 с, гипотеза H3).
 * — Браузеры и WebView Telegram запускают звук только из жеста игрока. Жест по стандарту — отпускание
 *   пальца (pointerup / touchend), клик или клавиша, а не pointerdown от касания. Слушаем их на window
 *   в фазе захвата (раньше обработчиков экранов) и пробуем снова, пока play() не пройдёт.
 * — Громкость вшита в файл (−12 дБ ≈ 0.25): на iOS audio.volume только для чтения.
 * — Вкладка скрыта или игра свёрнута — пауза; вернулись — продолжаем, если музыка включена.
 * — Вкл / выкл — настройка устройства в src/storage.ts (ключ game_music_enabled), формат game_state не меняется.
 */

import trackUrl from './assets/background.mp3'
import { loadMusicEnabled, saveMusicEnabled } from './storage'

/** События, которые браузеры считают жестом игрока (HTML, user activation) */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const
const LISTEN: AddEventListenerOptions = { capture: true, passive: true }

let audio: HTMLAudioElement | null = null
let source = trackUrl
let gain = 1
let initialized = false
let enabled = true
/** Трек уже звучал: после возврата во вкладку его можно продолжить без нового жеста */
let started = false

/**
 * Подготовить музыку: только слушатели жестов, без сети. Трек создаётся и грузится при первом жесте.
 * volume — множитель поверх громкости файла (0…1); на iOS не действует.
 */
export function initBackgroundMusic(src: string = trackUrl, volume = 1): void {
  if (initialized) return
  initialized = true
  source = src
  gain = Math.min(1, Math.max(0, volume))
  enabled = loadMusicEnabled()

  listenForGesture()
  document.addEventListener('visibilitychange', onVisibilityChange)
}

export function setMusicEnabled(value: boolean): void {
  enabled = value
  saveMusicEnabled(value)
  if (!initialized) return
  if (value) play()
  else audio?.pause()
}

export function isMusicEnabled(): boolean {
  return initialized ? enabled : loadMusicEnabled()
}

/** Переключить и вернуть новое состояние */
export function toggleMusic(): boolean {
  setMusicEnabled(!isMusicEnabled())
  return enabled
}

function listenForGesture(): void {
  for (const type of GESTURES) window.addEventListener(type, onGesture, LISTEN)
}

function stopListening(): void {
  for (const type of GESTURES) window.removeEventListener(type, onGesture, LISTEN)
}

function onGesture(): void {
  if (enabled) play()
}

function element(): HTMLAudioElement {
  if (audio) return audio
  const el = new Audio(source)
  el.loop = true
  el.preload = 'auto'
  el.volume = gain
  // Файл не загрузился (нет сети, обрыв) — следующий жест создаст элемент заново
  el.addEventListener('error', () => {
    if (audio !== el) return
    audio = null
    started = false
    listenForGesture()
  })
  audio = el
  return el
}

/** play() вызывается синхронно внутри обработчика жеста — иначе браузер его отклонит */
function play(): void {
  if (!enabled || document.visibilityState === 'hidden') return
  element()
    .play()
    .then(
      () => {
        started = true
        stopListening()
      },
      () => {
        // Жест не засчитан (Esc, ещё нет активации) — ждём следующего
      },
    )
}

function onVisibilityChange(): void {
  if (!audio) return
  if (document.visibilityState === 'hidden') {
    audio.pause()
    return
  }
  if (enabled && started) void audio.play().catch(() => {})
}
