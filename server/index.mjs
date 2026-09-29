/**
 * Минимальный сервер для Game TMA
 *
 * Две задачи:
 *   1. Раздавать статику из dist/ (вместо nginx)
 *   2. Принимать аналитические события (POST /api/events)
 *
 * Валидация initData: HMAC-SHA256 по спеке Telegram
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Хранение: JSONL-файл (одна строка — одно событие).
 * Для Г1 (до 50 тестеров) этого достаточно; к Г2 можно мигрировать на SQLite/Postgres.
 *
 * Зависимости: ноль (только Node built-in модули).
 */

import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, extname, resolve } from 'node:path'
import { createHmac } from 'node:crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PORT = Number(process.env.PORT) || 80
const BOT_TOKEN = process.env.BOT_TOKEN || ''
const DIST_DIR = resolve(__dirname, '..', 'dist')
const DATA_DIR = resolve(__dirname, '..', 'data')
const EVENTS_FILE = join(DATA_DIR, 'events.jsonl')

// Максимальный размер тела запроса (100 КБ)
const MAX_BODY = 100 * 1024

// ---------------------------------------------------------------------------
// Подготовка
// ---------------------------------------------------------------------------

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

if (!BOT_TOKEN) {
  console.warn('⚠ BOT_TOKEN не задан — валидация initData отключена, события от Telegram будут приниматься без проверки')
}

// ---------------------------------------------------------------------------
// MIME-типы для статики
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.webp': 'image/webp',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
}

// ---------------------------------------------------------------------------
// Валидация Telegram initData
// ---------------------------------------------------------------------------

/**
 * Проверить подпись initData и вернуть объект user.
 * Возвращает null, если подпись невалидна.
 * Возвращает {} (пустой объект), если подпись ок, но user отсутствует.
 */
function validateInitData(raw) {
  if (!BOT_TOKEN || !raw) return null

  const params = new URLSearchParams(raw)
  const hash = params.get('hash')
  if (!hash) return null

  params.delete('hash')
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
  const checkString = sorted.map(([k, v]) => `${k}=${v}`).join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const computedHash = createHmac('sha256', secretKey).update(checkString).digest('hex')

  if (computedHash !== hash) return null

  try {
    const userData = params.get('user')
    if (userData) return JSON.parse(userData)
  } catch { /* ignore parse errors */ }

  return {}
}

// ---------------------------------------------------------------------------
// Чтение тела запроса
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        req.destroy()
        reject(new Error('Body too large'))
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })

    req.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// HTTP-сервер
// ---------------------------------------------------------------------------

const server = createServer(async (req, res) => {
  // ── API: приём событий ──────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/events') {
    try {
      const body = await readBody(req)
      const { initData: rawInitData, events } = body

      if (!Array.isArray(events) || events.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end('{"error":"no events"}')
        return
      }

      if (events.length > 100) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end('{"error":"too many events"}')
        return
      }

      // Определить user_id
      let userId = null
      if (rawInitData) {
        if (BOT_TOKEN) {
          const user = validateInitData(rawInitData)
          if (user === null) {
            res.writeHead(403, { 'Content-Type': 'application/json' })
            res.end('{"error":"invalid initData"}')
            return
          }
          userId = user.id ?? null
        }
        // Если BOT_TOKEN не задан — принимаем без проверки (dev-режим)
      }

      // Записать в JSONL
      const serverTs = Date.now()
      const lines = events
        .map((e) =>
          JSON.stringify({
            ...e,
            user_id: userId,
            server_ts: serverTs,
          }),
        )
        .join('\n')

      appendFileSync(EVENTS_FILE, lines + '\n')

      // Дублировать в stdout для логов контейнера
      console.log(`[events] +${events.length} from user=${userId ?? 'anon'}`)

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    } catch (err) {
      if (err.message === 'Body too large') {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end('{"error":"body too large"}')
        return
      }
      if (err.message === 'Invalid JSON') {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end('{"error":"invalid json"}')
        return
      }
      console.error('Events API error:', err)
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"error":"server error"}')
    }
    return
  }

  // ── Статика ─────────────────────────────────────────────────────────
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }

  // Разбираем URL (убираем query string)
  let pathname
  try {
    pathname = new URL(req.url, 'http://localhost').pathname
  } catch {
    res.writeHead(400)
    res.end()
    return
  }

  // Определяем путь к файлу
  let filePath = resolve(DIST_DIR, '.' + pathname)

  // Защита от directory traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403)
    res.end()
    return
  }

  // Если это каталог — ищем index.html внутри
  try {
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html')
    }
  } catch { /* ignore */ }

  // SPA fallback: если файл не найден и нет расширения — отдаём index.html
  if (!existsSync(filePath)) {
    if (!extname(filePath)) {
      filePath = join(DIST_DIR, 'index.html')
    } else {
      res.writeHead(404)
      res.end('Not found')
      return
    }
  }

  // Content-Type
  const ext = extname(filePath)
  const contentType = MIME[ext] || 'application/octet-stream'

  // Cache-Control: хешированные ассеты — навечно, остальное — no-cache
  const isHashed = filePath.includes('/assets/') || /\.[a-f0-9]{8}\./i.test(filePath)
  const cacheControl = isHashed ? 'public, max-age=31536000, immutable' : 'no-cache'

  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(filePath).pipe(res)
})

server.listen(PORT, () => {
  console.log(`Game server on :${PORT}  dist=${DIST_DIR}  data=${DATA_DIR}`)
  if (!BOT_TOKEN) console.log('  ⚠ BOT_TOKEN not set — initData validation disabled')
})
