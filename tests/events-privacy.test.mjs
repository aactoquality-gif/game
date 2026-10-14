/**
 * Приём событий и персональные данные.
 * — Из initData на сервер попадает только Telegram ID: имени, username и фамилии нет ни в events.jsonl, ни в журнале.
 * — Личность берётся только из initData с верной подписью бота и не старше суток: подделка, чужой ID, просрочка — 403.
 * — Имена из старых записей (до 14.10.2026) сервер вычищает при запуске, сами события остаются.
 * Сервер запускается копией во временной папке с тестовым BOT_TOKEN и своим DATA_DIR.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { createHmac } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const BOT_TOKEN = '123456:TEST-token-for-events-privacy'
const USER = { id: 424242, first_name: 'Маргарита', last_name: 'Тестова', username: 'margo_test', language_code: 'ru' }
const PERSONAL = ['Маргарита', 'Тестова', 'margo_test', 'first_name', 'last_name', 'username', 'user_name']
/** Записи в формате до 14.10.2026: с именем игрока */
const OLD_LINES = [
  { event: 'screen_view', ts: 1, story: 'namertvo', episode: 1, screen: 'e1_s01', run: 1, platform: 'telegram', session: 's1', device: 'd1', user_id: 1001, user_name: 'Старое Имя', verified: true, server_ts: 1 },
  { event: 'screen_view', ts: 2, story: 'namertvo', episode: 1, screen: 'e1_s02', run: 1, platform: 'browser', session: 's2', device: 'd2', user_id: null, user_name: null, verified: false, server_ts: 2 },
  { event: 'episode_start', ts: 3, story: 'namertvo', episode: 1, screen: 'e1_s01', run: 1, platform: 'telegram', session: 's3', device: 'd3', user_id: 1002, verified: true, server_ts: 3 },
]
/** Оборванная запись (падение посреди дозаписи): JSON не читается, но имя внутри есть */
const BROKEN_LINE = '{"event":"screen_view","ts":4,"user_id":1003,"user_name":"Битое Имя","verif'

let dir
let child
let port
let output = ''

async function freePort() {
  const srv = createServer()
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  const { port: p } = srv.address()
  await new Promise((done) => srv.close(done))
  return p
}

/** initData с подписью по спеке Telegram: secret = HMAC("WebAppData", token), hash = HMAC(secret, строки key=value по алфавиту) */
function signInitData(fields, token = BOT_TOKEN) {
  const params = new URLSearchParams(fields)
  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  params.set('hash', createHmac('sha256', secret).update(checkString).digest('hex'))
  return params.toString()
}

const now = () => Math.floor(Date.now() / 1000)
const validInitData = (user = USER, authDate = now()) =>
  signInitData({ query_id: 'AAE-test', user: JSON.stringify(user), auth_date: String(authDate) })

const event = () => ({
  event: 'screen_view', ts: Date.now(), story: 'namertvo', episode: 1, screen: 'e1_s01', run: 1,
  platform: 'telegram', session: 'sess-test', device: 'dev-test', data: { kind: 'text' },
})

function post(path, body) {
  return new Promise((done, fail) => {
    const payload = JSON.stringify(body)
    const req = request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      res.on('error', fail)
    })
    req.on('error', fail)
    req.end(payload)
  })
}

const eventsFile = () => join(dir, 'data', 'events.jsonl')
const storedLines = () => (existsSync(eventsFile()) ? readFileSync(eventsFile(), 'utf8').trim().split('\n').filter(Boolean) : [])

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'events-privacy-'))
  mkdirSync(join(dir, 'server'))
  for (const f of readdirSync(resolve('server')).filter((n) => n.endsWith('.mjs'))) {
    copyFileSync(resolve('server', f), join(dir, 'server', f))
  }
  mkdirSync(join(dir, 'dist'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html>')
  mkdirSync(join(dir, 'data'))
  writeFileSync(join(dir, 'data', 'events.jsonl'), [JSON.stringify(OLD_LINES[0]), BROKEN_LINE, ...OLD_LINES.slice(1).map((l) => JSON.stringify(l))].join('\n') + '\n')
  port = await freePort()
  child = spawn(process.execPath, [join(dir, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: join(dir, 'data'), BOT_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (d) => (output += d))
  child.stderr.on('data', (d) => (output += d))
  await new Promise((ready, fail) => {
    const timer = setTimeout(() => fail(new Error(`сервер не запустился:\n${output}`)), 10000)
    child.stdout.on('data', (d) => {
      if (String(d).includes('Game server')) {
        clearTimeout(timer)
        ready()
      }
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`сервер завершился (${code}):\n${output}`))
    })
  })
})

after(() => {
  child?.kill()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

test('старые записи: имена вычищены при запуске, битая строка с именем выброшена, события и ID на месте', () => {
  const lines = storedLines()
  assert.equal(lines.length, OLD_LINES.length)
  const stored = lines.map((l) => JSON.parse(l))
  for (const e of stored) assert.ok(!Object.hasOwn(e, 'user_name'), 'user_name остался')
  assert.deepEqual(stored.map((e) => e.user_id), OLD_LINES.map((e) => e.user_id))
  assert.deepEqual(stored.map((e) => e.screen), OLD_LINES.map((e) => e.screen))
  const raw = readFileSync(eventsFile(), 'utf8')
  assert.ok(!raw.includes('Старое Имя'))
  assert.ok(!raw.includes('Битое Имя'))
  assert.match(output, /\[privacy\] из старых событий убраны имена: 3/)
})

test('подписанный initData: в событии только ID, без имени и username', async () => {
  const before = storedLines().length
  const r = await post('/api/events', { initData: validInitData(), events: [event()] })
  assert.equal(r.status, 200, r.body)

  const lines = storedLines()
  assert.equal(lines.length, before + 1)
  const stored = JSON.parse(lines.at(-1))
  assert.equal(stored.user_id, USER.id)
  assert.equal(stored.verified, true)
  assert.deepEqual(Object.keys(stored).filter((k) => k.startsWith('user')), ['user_id'])
  for (const s of PERSONAL) assert.ok(!lines.at(-1).includes(s), `в events.jsonl попало «${s}»`)
})

test('журнал сервера: ID есть, имени и username нет', async () => {
  await post('/api/events', { initData: validInitData(), events: [event()] })
  await new Promise((r) => setTimeout(r, 100))
  assert.match(output, new RegExp(`user=${USER.id}`))
  for (const s of PERSONAL.slice(0, 3)) assert.ok(!output.includes(s), `в журнал попало «${s}»`)
})

test('подделка подписи — 403, ничего не записано', async () => {
  const before = storedLines().length
  const forged = validInitData().replace(/hash=[0-9a-f]+/, `hash=${'0'.repeat(64)}`)
  const r = await post('/api/events', { initData: forged, events: [event()] })
  assert.equal(r.status, 403)
  assert.equal(storedLines().length, before)
})

test('чужой ID в подписанных данных — 403', async () => {
  const before = storedLines().length
  const tampered = validInitData().replace(encodeURIComponent(`"id":${USER.id}`), encodeURIComponent('"id":777'))
  assert.notEqual(tampered, validInitData(), 'подмена ID должна изменить строку')
  const r = await post('/api/events', { initData: tampered, events: [event()] })
  assert.equal(r.status, 403)
  assert.equal(storedLines().length, before)
})

test('подпись другим токеном — 403', async () => {
  const before = storedLines().length
  const other = signInitData({ user: JSON.stringify(USER), auth_date: String(now()) }, '999:other-bot')
  const r = await post('/api/events', { initData: other, events: [event()] })
  assert.equal(r.status, 403)
  assert.equal(storedLines().length, before)
})

test('initData старше суток — 403', async () => {
  const before = storedLines().length
  const r = await post('/api/events', { initData: validInitData(USER, now() - 25 * 60 * 60), events: [event()] })
  assert.equal(r.status, 403)
  assert.equal(storedLines().length, before)
})

test('без initData (браузер) — событие анонимное', async () => {
  const r = await post('/api/events', { events: [{ ...event(), platform: 'browser' }] })
  assert.equal(r.status, 200, r.body)
  const last = JSON.parse(storedLines().at(-1))
  assert.equal(last.user_id, null)
  assert.equal(last.verified, false)
})
