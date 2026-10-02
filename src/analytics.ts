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

import type { EventName } from './tracking'

type Platform = 'telegram' | 'browser'

interface AnalyticsEvent {
  /** Имя события */
  event: string
  /** Клиентская метка времени */
  ts: number
  /** ID истории из каталога ("namertvo"); вне истории — пусто */
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
/** Пачка — не больше, чем принимает сервер (MAX_EVENTS в server/index.mjs): пачку больше он отклоняет целиком */
const MAX_BATCH = 100
/** Ответы сервера, после которых пачку стоит отправить ещё раз: перегрузка, сбой, недоступность */
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504]
/** Запрос без ответа дольше — считаем неудачным и возвращаем пачку в очередь */
const SEND_TIMEOUT_MS = 20_000

let platform: Platform = 'browser'
let story = ''
let episode = 0
/** Игрок сейчас в эпизоде (а не в меню) — от этого зависит, какое событие слать при сворачивании */
let inEpisode = false
let currentScreen = ''
let run = 1
let initData = ''
const session = randomId()
const device = loadDeviceId()

let buffer: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | undefined
/** Пачка уже в пути: следующая уходит после ответа, а не параллельно */
let sending = false

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
  // Страховка: если WebView закрыли без смены видимости — досылаем очередь при выгрузке страницы
  window.addEventListener('pagehide', () => flush(true))
}

/** Обновить контекст (при смене эпизода, рестарте, смене экрана) */
export function updateContext(opts: { story?: string; episode?: number; run?: number; screen?: string; inEpisode?: boolean }): void {
  if (opts.story !== undefined) story = opts.story
  if (opts.inEpisode !== undefined) inEpisode = opts.inEpisode
  if (opts.episode !== undefined) episode = opts.episode
  if (opts.run !== undefined) run = opts.run
  if (opts.screen !== undefined) currentScreen = opts.screen
}

/** Отправить событие в очередь. Имена — только из каталога src/tracking.ts */
export function track(event: EventName, data?: Record<string, unknown>): void {
  if (event === 'screen_view') screensInRun++

  buffer.push({
    event,
    ts: Date.now(),
    story,
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
    track(inEpisode ? 'episode_exit' : 'app_hide', inEpisode ? { screens_viewed: screensInRun, reason: 'hide' } : undefined)
    flush(true)
  }
}

/**
 * Отправить очередь пачками по MAX_BATCH.
 * Обычно — запросом, по одной пачке за раз: ответ пришёл — уходит следующая.
 * При сворачивании и закрытии — sendBeacon (браузер доставит и после закрытия); браузер отказал
 * (общий лимит 64 КБ) — одна пачка обычным запросом, остальное ждёт возвращения в игру.
 */
function flush(useBeacon: boolean): void {
  if (useBeacon && navigator.sendBeacon) {
    while (buffer.length > 0) {
      const events = buffer.slice(0, MAX_BATCH)
      const body = JSON.stringify({ initData, events })
      if (!navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) break
      buffer = buffer.slice(events.length)
    }
  }
  if (sending || buffer.length === 0) return

  const events = buffer.slice(0, MAX_BATCH)
  buffer = buffer.slice(events.length)
  sending = true
  post(events).then((delivered) => {
    sending = false
    if (!delivered) {
      // Сеть или сервер недоступны — пачка возвращается в начало очереди, повтор — по таймеру
      buffer = [...events, ...buffer].slice(-MAX_BUFFER)
      return
    }
    if (buffer.length > 0) flush(false)
  })
}

/**
 * Пачка одним запросом. true — сервер её принял или отклонил окончательно (повтор не поможет);
 * false — нет сети, нет ответа или сервер временно недоступен (RETRY_STATUSES).
 */
function post(events: AnalyticsEvent[]): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData, events }),
    keepalive: true,
    signal: controller.signal,
  })
    .then((res) => res.ok || !RETRY_STATUSES.includes(res.status))
    .catch(() => false)
    .finally(() => clearTimeout(timer))
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
