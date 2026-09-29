/**
 * Аналитика по образцу Seven Hearts:
 * — общая шапка (story, episode, screen, run, platform, session, device, ts)
 * — очередь событий с батч-отправкой
 * — sendBeacon при сворачивании/закрытии
 *
 * Клиент НЕ шлёт ID игрока — сервер берёт его из проверенного initData.
 * device — анонимный ID устройства, нужен только для режима браузера (там нет initData).
 */

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

type Platform = 'telegram' | 'browser'

interface AnalyticsEvent {
  /** Имя события */
  event: string
  /** Клиентская метка времени */
  ts: number
  /** Всегда "game" (будущее: ID истории в антологии) */
  story: string
  /** Номер эпизода (глава) */
  episode: number
  /** Текущий экран */
  screen: string
  /** Номер прохождения эпизода (начинается с 1, растёт при рестарте) */
  run: number
  /** Платформа: telegram или browser */
  platform: Platform
  /** ID открытия игры: одна сессия = один «присест» (гипотеза H1) */
  session: string
  /** Анонимный ID устройства */
  device: string
  /** Дополнительные данные, специфичные для события */
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Состояние модуля
// ---------------------------------------------------------------------------

const ENDPOINT = '/api/events'
const FLUSH_INTERVAL_MS = 10_000
/** Потолок очереди: без сети события не должны копиться бесконечно */
const MAX_BUFFER = 500

let platform: Platform = 'browser'
let episode = 1
let currentScreen = ''
let run = 1
let initData = ''
const session = randomId()
const device = loadDeviceId()

let buffer: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | undefined

/** Счётчик экранов за текущий run в этой сессии */
let screensInRun = 0

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

/**
 * Инициализировать аналитику. Вызывать ДО запуска движка:
 * первые события (episode_enter, первый screen_view) должны уйти с правильной платформой.
 */
export function initAnalytics(opts: { platform: Platform; initData: string }): void {
  platform = opts.platform
  initData = opts.initData

  clearInterval(flushTimer)
  flushTimer = setInterval(() => flush(false), FLUSH_INTERVAL_MS)

  document.addEventListener('visibilitychange', onVisibilityChange)
}

/** Обновить контекст (при смене эпизода, рестарте, смене экрана) */
export function updateContext(opts: { episode?: number; run?: number; screen?: string }): void {
  if (opts.episode !== undefined) episode = opts.episode
  if (opts.run !== undefined) run = opts.run
  if (opts.screen !== undefined) currentScreen = opts.screen
}

/** Отправить событие в очередь */
export function track(event: string, data?: Record<string, unknown>): void {
  if (event === 'screen_view') screensInRun++

  buffer.push({
    event,
    ts: Date.now(),
    story: 'game',
    episode,
    screen: currentScreen,
    run,
    platform,
    session,
    device,
    ...(data ? { data } : {}),
  })

  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
}

/** Сбросить счётчик экранов (вызывается при рестарте эпизода) */
export function resetRunCounters(): void {
  screensInRun = 0
}

/** Сколько экранов просмотрено в текущем run за эту сессию */
export function getScreensInRun(): number {
  return screensInRun
}

// ---------------------------------------------------------------------------
// Внутренние функции
// ---------------------------------------------------------------------------

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    track('episode_exit', { screens_viewed: screensInRun })
    flush(true)
  }
}

function flush(useBeacon: boolean): void {
  if (buffer.length === 0) return

  const events = buffer
  buffer = []

  const body = JSON.stringify({ initData, events })

  if (useBeacon && navigator.sendBeacon) {
    const queued = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))
    if (queued) return
    // Браузер отказал (например, лимит 64 КБ) — пробуем обычным запросом
  }

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // Сеть недоступна — вернуть события в очередь для повторной отправки
    buffer = [...events, ...buffer].slice(-MAX_BUFFER)
  })
}

function randomId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** Анонимный ID устройства в localStorage; если хранилище недоступно — ID на сессию */
function loadDeviceId(): string {
  const KEY = 'game_device_id'
  try {
    const existing = localStorage.getItem(KEY)
    if (existing) return existing
    const id = randomId()
    localStorage.setItem(KEY, id)
    return id
  } catch {
    return randomId()
  }
}
