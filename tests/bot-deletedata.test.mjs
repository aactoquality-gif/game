/**
 * Вебхук бота и удаление данных по запросу игрока (/deletedata).
 * — Только запросы с верным X-Telegram-Bot-Api-Secret-Token; без BOT_WEBHOOK_SECRET вебхук выключен (404).
 * — /deletedata ничего не удаляет, только предупреждает; /deletedata_confirm удаляет все события этого Telegram ID
 *   и не трогает чужие.
 * — Апдейт не логируется: в журнале нет имени и username, только ID и тип события.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const SECRET = 'test_webhook_secret-123'
const ALICE = { id: 111, first_name: 'Алиса', username: 'alice_reader', is_bot: false }
const BOB = { id: 222, first_name: 'Борис', username: 'bob_reader', is_bot: false }

const line = (userId, screen) => JSON.stringify({
  event: 'screen_view', ts: 1, story: 'namertvo', episode: 1, screen, run: 1,
  platform: userId ? 'telegram' : 'browser', session: 's', device: 'd', user_id: userId, verified: !!userId, server_ts: 1,
})
const SEED = [line(111, 'e1_s01'), line(222, 'e1_s01'), line(111, 'e1_s02'), line(null, 'e1_s01'), line(111, 'e1_s03'), line(222, 'e1_s02')]

/** Запустить копию сервера во временной папке */
async function startServer(env) {
  const dir = mkdtempSync(join(tmpdir(), 'bot-deletedata-'))
  mkdirSync(join(dir, 'server'))
  for (const f of readdirSync(resolve('server')).filter((n) => n.endsWith('.mjs'))) {
    copyFileSync(resolve('server', f), join(dir, 'server', f))
  }
  mkdirSync(join(dir, 'dist'))
  writeFileSync(join(dir, 'dist', 'index.html'), '<!doctype html>')
  mkdirSync(join(dir, 'data'))
  writeFileSync(join(dir, 'data', 'events.jsonl'), SEED.join('\n') + '\n')

  const srv = createServer()
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  const { port } = srv.address()
  await new Promise((done) => srv.close(done))

  const s = { dir, port, output: '', child: null }
  s.child = spawn(process.execPath, [join(dir, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: join(dir, 'data'), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  s.child.stdout.on('data', (d) => (s.output += d))
  s.child.stderr.on('data', (d) => (s.output += d))
  await new Promise((ready, fail) => {
    const timer = setTimeout(() => fail(new Error(`сервер не запустился:\n${s.output}`)), 10000)
    s.child.stdout.on('data', (d) => {
      if (String(d).includes('Game server')) {
        clearTimeout(timer)
        ready()
      }
    })
    s.child.once('exit', (code) => {
      clearTimeout(timer)
      fail(new Error(`сервер завершился (${code}):\n${s.output}`))
    })
  })
  return s
}

function stopServer(s) {
  s?.child?.kill()
  if (s?.dir) rmSync(s.dir, { recursive: true, force: true })
}

function webhook(s, update, secret = SECRET) {
  return new Promise((done, fail) => {
    const payload = JSON.stringify(update)
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret
    const req = request({ hostname: '127.0.0.1', port: s.port, path: '/api/telegram/webhook', method: 'POST', headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString()
        done({ status: res.statusCode, body, json: body ? JSON.parse(body) : null })
      })
      res.on('error', fail)
    })
    req.on('error', fail)
    req.end(payload)
  })
}

let updateId = 1
const message = (from, text, chatType = 'private') => ({
  update_id: updateId++,
  message: {
    message_id: updateId, date: Math.floor(Date.now() / 1000), text, from,
    chat: chatType === 'private' ? { id: from.id, type: 'private', first_name: from.first_name, username: from.username } : { id: -100500, type: chatType, title: 'Чат' },
  },
})

const userIds = (s) => readFileSync(join(s.dir, 'data', 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).user_id)

let server

before(async () => {
  server = await startServer({ BOT_WEBHOOK_SECRET: SECRET })
})

after(() => stopServer(server))

test('без заголовка секрета — 403, данные на месте', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata_confirm'), null)
  assert.equal(r.status, 403)
  assert.equal(userIds(server).length, SEED.length)
})

test('неверный секрет — 403, данные на месте', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata_confirm'), 'wrong_secret')
  assert.equal(r.status, 403)
  assert.equal(userIds(server).length, SEED.length)
})

test('/deletedata — предупреждение со ссылкой на подтверждение, ничего не удалено', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata'))
  assert.equal(r.status, 200)
  assert.equal(r.json.method, 'sendMessage')
  assert.equal(r.json.chat_id, ALICE.id)
  assert.match(r.json.text, /\/deletedata_confirm/)
  assert.match(r.json.text, /Купленное станет недоступно/)
  assert.equal(userIds(server).length, SEED.length)
})

test('в группе команда не работает', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata_confirm', 'supergroup'))
  assert.equal(r.status, 200)
  assert.equal(r.body, '')
  assert.equal(userIds(server).length, SEED.length)
})

test('/deletedata_confirm удаляет все события игрока и только его', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata_confirm@namertvo_bot'))
  assert.equal(r.status, 200)
  assert.equal(r.json.chat_id, ALICE.id)
  assert.match(r.json.text, /удалено записей: 3/)
  assert.deepEqual(userIds(server), [222, null, 222])
})

test('повторный запрос — данных уже нет', async () => {
  const r = await webhook(server, message(ALICE, '/deletedata_confirm'))
  assert.equal(r.status, 200)
  assert.match(r.json.text, /нет данных/)
  assert.deepEqual(userIds(server), [222, null, 222])
})

test('другие сообщения — 200 без ответа', async () => {
  const r = await webhook(server, message(BOB, 'привет'))
  assert.equal(r.status, 200)
  assert.equal(r.body, '')
  const r2 = await webhook(server, { update_id: updateId++, edited_message: { text: '/deletedata_confirm', from: BOB, chat: { id: BOB.id, type: 'private' } } })
  assert.equal(r2.status, 200)
  assert.deepEqual(userIds(server), [222, null, 222])
})

test('журнал: только ID и тип события, без имён и username', async () => {
  await new Promise((r) => setTimeout(r, 100))
  assert.match(server.output, /\[bot\] deletedata_done user=111 removed=3/)
  for (const s of ['Алиса', 'alice_reader', 'Борис', 'bob_reader', 'привет', 'first_name']) {
    assert.ok(!server.output.includes(s), `в журнал попало «${s}»`)
  }
})

test('без BOT_WEBHOOK_SECRET вебхук выключен — 404', async () => {
  const off = await startServer({ BOT_WEBHOOK_SECRET: '' })
  try {
    const r = await webhook(off, message(ALICE, '/deletedata_confirm'), '')
    assert.equal(r.status, 404)
    assert.equal(userIds(off).length, SEED.length)
    assert.match(off.output, /BOT_WEBHOOK_SECRET не задан/)
  } finally {
    stopServer(off)
  }
})
