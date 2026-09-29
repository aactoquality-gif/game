/**
 * Аналитика по образцу Seven Hearts:
 * — общая шапка (story, episode, screen, run, platform, ts)
 * — очередь событий с батч-отправкой
 * — sendBeacon при сворачивании/закрытии
 *
 * Клиент НЕ шлёт ID игрока — сервер берёт его из проверенного initData.
 */

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

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
  platform: 'telegram' | 'browser'
  /** Дополнительные данные, специфичные для события */
  data?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Состояние модуля
// ---------------------------------------------------------------------------

let platform: 'telegram' | 'browser' = 'browser'
let episode = 1
let currentScreen = ''
let run = 1
let initData = ''

let buffer: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | undefined

/** Счётчик экранов за текущий run (для episode_exit.screens_viewed) */
let screensInRun = 0

// ---------------------------------------------------------------------------
// Публичный API
// ---------------------------------------------------------------------------

/** Инициализировать аналитику при старте игры */
export function initAnalytics(opts: {
  platform: 'telegram' | 'browser'
  episode: number
  run: number
  initData: string
}): void {
  platform = opts.platform
  episode = opts.episode
  run = opts.run
  initData = opts.initData
  screensInRun = 0

  // Автосброс каждые 10 секунд
  clearInterval(flushTimer)
  flushTimer = setInterval(() => flush(false), 10_000)

  // При сворачивании / закрытии — отправить всё через Beacon
  document.addEventListener('visibilitychange', onVisibilityChange)
}

/** Обновить контекст (при смене эпизода, рестарте, смене экрана) */
export function updateContext(opts: {
  episode?: number
  run?: number
  screen?: string
}): void {
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
    ...(data ? { data } : {}),
  })
}

/** Сбросить счётчик экранов (вызывается при рестарте эпизода) */
export function resetRunCounters(): void {
  screensInRun = 0
}

/** Получить текущее количество просмотренных экранов в run */
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
    navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }))
    return
  }

  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    // При ошибке — вернуть события в очередь для повторной отправки
    buffer.unshift(...events)
  })
}
