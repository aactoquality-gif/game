/**
 * Минимальный сервер для Game TMA
 *
 *   GET  /*                 — статика из dist/ (вместо nginx)
 *   POST /api/events        — приём аналитических событий пачками
 *   GET  /api/stats         — отчёт по гипотезам Г1 (admin cookie)
 *   GET  /api/stats/download — сырые события (admin cookie)
 *   GET  /api/health        — проверка, что сервер жив
 *   POST /api/telegram/webhook — вебхук бота: /deletedata (server/bot.mjs)
 *
 * Переменные окружения:
 *   BOT_TOKEN  — токен бота; включает проверку подписи initData
 *   BOT_WEBHOOK_SECRET — secret_token вебхука (A-Za-z0-9_-, до 256); без него вебхук выключен
 *   STATS_*   — настройки беспарольного входа, см. docs/stats-auth.md
 *   DATA_DIR   — куда писать events.jsonl (на Amvera — постоянный диск /data)
 *   PORT       — порт (по умолчанию 80)
 *
 * Валидация initData: HMAC-SHA256 по спеке Telegram
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Персональные данные: из initData на сервер попадает только числовой Telegram ID.
 * Имя, username, фото и язык не пишутся ни в events.jsonl, ни в журнал (console).
 *
 * Зависимости: ноль (только Node built-in модули).
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createStatsAuth, createClientIp } from './stats-auth.mjs'
import { loadEvents, loadChapter, buildReport, renderHtml } from './stats.mjs'
import { stripStoredNames, removeStaleTemps } from './events-store.mjs'
import { createBotWebhook } from './bot.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.PORT) || 80
const BOT_TOKEN = process.env.BOT_TOKEN || ''
const DIST_DIR = resolve(__dirname, '..', 'dist')
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, '..', 'data'))
const EVENTS_FILE = join(DATA_DIR, 'events.jsonl')

const VERSION = 'events-v2'
/** Максимальный размер тела запроса */
const MAX_BODY = 100 * 1024
/** Максимум событий в одной пачке */
const MAX_EVENTS = 100
/** initData старше суток не принимаем — защита от повторной отправки чужой подписи */
const INIT_DATA_MAX_AGE_S = 24 * 60 * 60
/** Лимит запросов с одного IP в минуту */
const RATE_LIMIT_PER_MIN = 120

// ---------------------------------------------------------------------------
// Подготовка
// ---------------------------------------------------------------------------

mkdirSync(DATA_DIR, { recursive: true })

// Незавершённые копии журнала после падения — удалить; имена игроков из записей до 14.10.2026 — вычистить.
// Файл без имён не перезаписывается
try {
  const stale = removeStaleTemps(EVENTS_FILE)
  if (stale) console.log(`[privacy] удалены незавершённые копии журнала: ${stale}`)
} catch (err) {
  console.error(`[privacy] не удалось удалить копии журнала: ${err.code || err.message}`)
}
try {
  const cleaned = stripStoredNames(EVENTS_FILE)
  if (cleaned) console.log(`[privacy] из старых событий убраны имена и битые строки: ${cleaned}`)
} catch (err) {
  console.error(`[privacy] не удалось убрать имена из ${EVENTS_FILE}: ${err.code || err.message}`)
}

const statsAuth = createStatsAuth({ dataDir: DATA_DIR })
const bot = createBotWebhook({ secret: process.env.BOT_WEBHOOK_SECRET || '', eventsFile: EVENTS_FILE })
const resolveClientIp = createClientIp(process.env.TRUSTED_PROXY_CIDRS)

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
}

/** Медиа отдаётся с поддержкой Range: iOS (Safari и WebView Telegram) без неё звук не играет */
const MEDIA = new Set(['.mp3', '.m4a', '.ogg'])

// ---------------------------------------------------------------------------
// Утилиты
// ---------------------------------------------------------------------------

function safeEqual(a, b) {
  const ba = Buffer.from(String(a))
  const bb = Buffer.from(String(b))
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders })
  res.end(JSON.stringify(obj))
}

function clientIp(req) {
  return resolveClientIp(req)
}

// ---------------------------------------------------------------------------
// Лимит запросов (в памяти; для одной реплики достаточно)
// ---------------------------------------------------------------------------

const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || now - h.start > 60_000) {
    hits.set(ip, { start: now, count: 1 })
    return false
  }
  h.count++
  return h.count > RATE_LIMIT_PER_MIN
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, h] of hits) if (now - h.start > 60_000) hits.delete(ip)
}, 60_000).unref()

// ---------------------------------------------------------------------------
// Telegram initData
// ---------------------------------------------------------------------------

/**
 * Разобрать initData.
 * С BOT_TOKEN — проверить подпись и срок; при ошибке вернуть null.
 * Без BOT_TOKEN (dev) — вернуть пользователя без проверки, verified: false.
 * Из пользователя наружу отдаётся только числовой id — имя и username дальше не уходят.
 * @returns {{ user: { id: number } | null, verified: boolean } | null}
 */
function parseInitData(raw) {
  const params = new URLSearchParams(raw)
  let user = null
  try {
    const u = params.get('user')
    const id = u ? JSON.parse(u)?.id : null
    if (Number.isSafeInteger(id) && id > 0) user = { id }
  } catch { /* ignore */ }

  if (!BOT_TOKEN) return { user, verified: false }

  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const computed = createHmac('sha256', secretKey).update(checkString).digest('hex')
  if (!safeEqual(computed, hash)) return null

  const authDate = Number(params.get('auth_date'))
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_S) return null

  return { user, verified: true }
}

// ---------------------------------------------------------------------------
// Очистка событий: пишем только известные поля ограниченной длины
// ---------------------------------------------------------------------------

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null)
const int = (v) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null)

function cleanEvent(e) {
  if (!e || typeof e !== 'object') return null
  const event = str(e.event, 40)
  if (!event || !/^[a-z_]+$/.test(event)) return null

  let data
  if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) {
    const json = JSON.stringify(e.data)
    if (json.length <= 1024) data = e.data
  }

  return {
    event,
    ts: Number.isFinite(e.ts) ? e.ts : null,
    story: str(e.story, 40),
    episode: int(e.episode),
    screen: str(e.screen, 64),
    run: int(e.run),
    platform: e.platform === 'telegram' ? 'telegram' : 'browser',
    session: str(e.session, 40),
    device: str(e.device, 40),
    ...(data ? { data } : {}),
  }
}

// ---------------------------------------------------------------------------
// Обработчики API
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    const onData = (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        // Дальше не копим: остаток тела сливаем в никуда, ответ 413 закроет соединение
        req.off('data', onData)
        req.resume()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

async function handleEvents(req, res) {
  if (rateLimited(clientIp(req))) return sendJson(res, 429, { error: 'too many requests' })

  let body
  try {
    body = await readBody(req)
  } catch (err) {
    if (err.message === 'Body too large') return sendJson(res, 413, { error: 'body too large' }, { Connection: 'close' })
    return sendJson(res, 400, { error: 'invalid json' })
  }

  const { initData: rawInitData, events } = body ?? {}
  if (!Array.isArray(events) || events.length === 0) return sendJson(res, 400, { error: 'no events' })
  if (events.length > MAX_EVENTS) return sendJson(res, 400, { error: 'too many events' })

  // Кто прислал. Без initData — режим браузера, игрок анонимный (различаем по device).
  // Из initData берём только ID: имя и username на сервере не храним (решение владельца, 14.10.2026)
  let userId = null
  let verified = false
  if (rawInitData) {
    const parsed = parseInitData(String(rawInitData))
    if (!parsed) return sendJson(res, 403, { error: 'invalid initData' })
    userId = parsed.user?.id ?? null
    verified = parsed.verified
  }

  const serverTs = Date.now()
  const lines = []
  for (const raw of events) {
    const e = cleanEvent(raw)
    if (e) lines.push(JSON.stringify({ ...e, user_id: userId, verified, server_ts: serverTs }))
  }
  if (lines.length === 0) return sendJson(res, 400, { error: 'no valid events' })

  try {
    appendFileSync(EVENTS_FILE, lines.join('\n') + '\n')
  } catch (err) {
    console.error('Не удалось записать события:', err)
    return sendJson(res, 500, { error: 'storage error' })
  }

  console.log(`[events] +${lines.length} user=${userId ?? 'anon'}${verified ? '' : ' (unverified)'}`)
  sendJson(res, 200, { ok: true, accepted: lines.length })
}

function handleStats(url, res) {
  const episode = Number(url.searchParams.get('episode')) || 1
  const storyParam = url.searchParams.get('story') ?? ''
  const story = /^[a-z0-9_-]{1,40}$/.test(storyParam) ? storyParam : 'namertvo'
  const fromStr = url.searchParams.get('from') ?? ''
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? Date.parse(`${fromStr}T00:00:00+03:00`) : 0
  const excludeStr = url.searchParams.get('exclude') ?? ''
  const exclude = excludeStr.split(',').map((s) => s.trim()).filter(Boolean)

  const report = buildReport(loadEvents(EVENTS_FILE), {
    story,
    episode,
    chapter: loadChapter(DIST_DIR, episode, story),
    from,
    exclude,
  })

  if (url.searchParams.get('format') === 'json') return sendJson(res, 200, report)

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  })
  res.end(renderHtml(report, { verifyOn: !!BOT_TOKEN, dataDir: DATA_DIR, from: fromStr, exclude: excludeStr }))
}

/** Отдать events.jsonl целиком: файла нет — пустой 200; есть, но не читается — 500 */
function handleRawEvents(url, res) {
  const headers = {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Content-Disposition': 'attachment; filename="events.jsonl"',
    'Cache-Control': 'no-store',
  }
  // Файла ещё нет — пустая выгрузка; файл есть, но не читается (права, каталог) — 500, а не пустой 200
  try {
    statSync(EVENTS_FILE)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Не удалось проверить ${EVENTS_FILE}: ${err.code || err.message}`)
      return sendJson(res, 500, { error: 'storage error' })
    }
    res.writeHead(200, headers)
    return res.end()
  }
  sendFile(res, EVENTS_FILE, headers)
}

// ---------------------------------------------------------------------------
// Файлы
// ---------------------------------------------------------------------------

/**
 * Отдать файл потоком. Заголовки уходят вместе с первым куском файла, поэтому ошибка чтения
 * (файл пропал, нет прав, на месте файла каталог) до начала ответа — 500, а не падение процесса;
 * ошибка посреди ответа — обрыв соединения. Клиент ушёл — поток закрывается.
 */
function sendFile(res, filePath, headers, range) {
  const stream = createReadStream(filePath, range ? { start: range.start, end: range.end } : undefined)
  const status = range ? 206 : 200
  const begin = () => {
    if (!res.headersSent) res.writeHead(status, headers)
  }
  stream.on('data', (chunk) => {
    begin()
    if (!res.write(chunk)) stream.pause()
  })
  res.on('drain', () => stream.resume())
  stream.on('end', () => {
    begin()
    res.end()
  })
  stream.on('error', (err) => {
    console.error(`Не удалось отдать файл ${filePath}: ${err.code || err.message}`)
    if (res.headersSent) return res.destroy()
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end('Internal error')
  })
  res.on('close', () => stream.destroy())
}

// ---------------------------------------------------------------------------
// Статика
// ---------------------------------------------------------------------------

/** Отдать статику из dist/ (с SPA fallback на index.html), либо только заголовки на HEAD */
function serveStatic(req, res, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400)
    return res.end()
  }
  let filePath = resolve(DIST_DIR, '.' + decoded)

  // Защита от выхода за пределы dist/
  if (filePath !== DIST_DIR && !filePath.startsWith(DIST_DIR + sep)) {
    res.writeHead(403)
    return res.end()
  }

  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html')
  } catch { /* ignore */ }

  // SPA fallback: файла нет и у пути нет расширения — отдаём index.html
  if (!existsSync(filePath)) {
    if (extname(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('Not found')
    }
    filePath = join(DIST_DIR, 'index.html')
  }

  const ext = extname(filePath)
  // Хешированные ассеты Vite — навечно, остальное (index.html, главы) — сверяться с сервером
  const isHashed = filePath.includes(`${sep}assets${sep}`)

  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  }

  let range
  if (MEDIA.has(ext)) {
    headers['Accept-Ranges'] = 'bytes'
    let size = -1
    try {
      size = statSync(filePath).size
    } catch { /* ошибку чтения покажет sendFile — 500 */ }
    if (size >= 0) {
      range = parseRange(req.headers.range, size)
      if (range === null) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Cache-Control': 'no-store' })
        return res.end()
      }
      if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      headers['Content-Length'] = String(range ? range.end - range.start + 1 : size)
    }
  }

  if (req.method === 'HEAD') {
    res.writeHead(range ? 206 : 200, headers)
    return res.end()
  }
  sendFile(res, filePath, headers, range)
}

/**
 * Один диапазон из заголовка Range (RFC 9110): { start, end } включительно.
 * undefined — отдать файл целиком (заголовка нет, несколько диапазонов или не bytes — так можно по стандарту);
 * null — диапазон за пределами файла (416).
 */
function parseRange(header, size) {
  if (typeof header !== 'string') return undefined
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return undefined
  let start
  let end
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (suffix === 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) return null
  return { start, end }
}

// ---------------------------------------------------------------------------
// Роутинг
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  let url
  try {
    url = new URL(req.url, 'http://localhost')
  } catch {
    res.writeHead(400)
    return res.end()
  }
  const { pathname } = url

  try {
    if (pathname === '/api/events' && req.method === 'POST') return await handleEvents(req, res)
    if (pathname === '/api/health' && req.method === 'GET') return sendJson(res, 200, { ok: true, version: VERSION })
    if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
      if (!bot.enabled) return sendJson(res, 404, { error: 'not found' })
      if (!bot.authorized(req)) return sendJson(res, 403, { error: 'forbidden' })
      let update
      try { update = await readBody(req) } catch (err) {
        return sendJson(res, err.message === 'Body too large' ? 413 : 400, { error: 'invalid request' })
      }
      return bot.handle(res, update)
    }
    if (pathname.startsWith('/api/stats/auth/') && req.method === 'POST') {
      const action = pathname.slice('/api/stats/auth/'.length)
      if (!['telegram', 'email/request', 'email/verify'].includes(action)) return sendJson(res, 404, { error: 'not found' })
      let body
      try { body = await readBody(req) } catch (err) {
        return sendJson(res, err.message === 'Body too large' ? 413 : 400, { error: 'invalid request' })
      }
      return await statsAuth.handle(req, res, action, body, clientIp(req))
    }
    if (['/api/stats', '/api/stats/download', '/api/events.jsonl'].includes(pathname) && req.method === 'GET') {
      // Strip legacy secrets before rendering anything; never copy unknown query parameters.
      if (url.searchParams.has('key')) {
        const clean = new URLSearchParams()
        for (const name of ['story', 'episode', 'from', 'exclude', 'format']) {
          if (url.searchParams.has(name)) clean.set(name, url.searchParams.get(name))
        }
        res.writeHead(303, { Location: pathname + (clean.size ? `?${clean}` : ''), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
        return res.end()
      }
      const html = pathname === '/api/stats' && url.searchParams.get('format') !== 'json'
      if (!statsAuth.authorize(req, res, html ? () => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' })
        createReadStream(join(DIST_DIR, 'stats-login.html')).on('error', () => res.destroy()).pipe(res)
      } : undefined)) return
      if (pathname === '/api/stats') return handleStats(url, res)
      return handleRawEvents(url, res)
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405)
      return res.end()
    }
    serveStatic(req, res, pathname)
  } catch (err) {
    console.error('Server error:', err)
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' })
    else res.end()
  }
})

server.listen(PORT, () => {
  console.log(`Game server ${VERSION} on :${PORT}  dist=${DIST_DIR}  data=${DATA_DIR}`)
  if (!BOT_TOKEN) console.warn('  ⚠ BOT_TOKEN не задан — подпись initData не проверяется')
  if (!statsAuth.enabled) console.warn('  ⚠ Stats authentication unavailable: configure STATS_SESSION_SECRET and STATS_ORIGIN')
  if (!bot.enabled) console.warn('  ⚠ BOT_WEBHOOK_SECRET не задан — вебхук бота (/deletedata) выключен')
})
