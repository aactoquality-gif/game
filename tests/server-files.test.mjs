/**
 * Раздача файлов сервером: ошибка чтения файла не должна ронять процесс.
 * Сервер запускается копией во временной папке — со своим dist/, где index.html — каталог
 * (чтение падает с EISDIR, как при битой выкладке). Старый код на этом завершал процесс Node.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { once } from 'node:events'

const BIG = 'x'.repeat(3 * 1024 * 1024)
/** «Трек»: у каждого байта своё место — по телу видно, какой кусок пришёл */
const TRACK = 'abcdefghijklmnopqrstuvwxyz0123456789'.repeat(1000)

let dir
let child
let port
let output = ''

/** Занять и тут же освободить порт — чтобы запустить сервер на свободном порту */
async function freePort() {
  const srv = createServer()
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  const { port: p } = srv.address()
  await new Promise((done) => srv.close(done))
  return p
}

/** Запрос к тестовому серверу, тело ответа собирается целиком */
function get(path, method = 'GET', headers = {}) {
  return new Promise((done, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      res.on('error', fail)
    })
    req.on('error', fail)
    req.end()
  })
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'server-files-'))
  mkdirSync(join(dir, 'server'))
  for (const f of readdirSync(resolve('server')).filter((n) => n.endsWith('.mjs'))) {
    copyFileSync(resolve('server', f), join(dir, 'server', f))
  }
  mkdirSync(join(dir, 'dist', 'assets'), { recursive: true })
  mkdirSync(join(dir, 'dist', 'index.html')) // каталог на месте файла — чтение падает
  writeFileSync(join(dir, 'dist', 'ok.json'), '{"ok":true}')
  writeFileSync(join(dir, 'dist', 'empty.json'), '')
  writeFileSync(join(dir, 'dist', 'assets', 'big.js'), BIG)
  writeFileSync(join(dir, 'dist', 'assets', 'track.mp3'), TRACK)

  port = await freePort()
  child = spawn(process.execPath, [join(dir, 'server', 'index.mjs')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: join(dir, 'data') },
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

test('обычный файл отдаётся целиком с заголовками', async () => {
  const r = await get('/ok.json')
  assert.equal(r.status, 200)
  assert.equal(r.body, '{"ok":true}')
  assert.match(r.headers['content-type'], /application\/json/)
  assert.equal(r.headers['cache-control'], 'no-cache')
})

test('пустой файл — 200 и пустое тело', async () => {
  const r = await get('/empty.json')
  assert.equal(r.status, 200)
  assert.equal(r.body, '')
})

test('большой файл приходит полностью (поток не теряет куски)', async () => {
  const r = await get('/assets/big.js')
  assert.equal(r.status, 200)
  assert.equal(r.body.length, BIG.length)
  assert.match(r.headers['cache-control'], /immutable/)
})

test('HEAD — только заголовки', async () => {
  const r = await get('/ok.json', 'HEAD')
  assert.equal(r.status, 200)
  assert.equal(r.body, '')
})

test('файла нет — 404', async () => {
  const r = await get('/missing.js')
  assert.equal(r.status, 404)
})

test('файл не читается — 500, процесс жив', async () => {
  const r = await get('/')
  assert.equal(r.status, 500)
  const again = await get('/some/route')
  assert.equal(again.status, 500, 'SPA-переход на тот же битый index.html — снова 500')
  assert.equal(child.exitCode, null, `процесс завершился:\n${output}`)
  const health = await get('/api/health')
  assert.equal(health.status, 200)
  assert.equal(JSON.parse(health.body).ok, true)
})

// Музыка: iOS (Safari и WebView Telegram) играет медиа только с сервера, который понимает Range и отдаёт тип звука

test('mp3 без Range — целиком, тип audio/mpeg, сервер объявляет Range', async () => {
  const r = await get('/assets/track.mp3')
  assert.equal(r.status, 200)
  assert.equal(r.body, TRACK)
  assert.equal(r.headers['content-type'], 'audio/mpeg')
  assert.equal(r.headers['accept-ranges'], 'bytes')
  assert.equal(r.headers['content-length'], String(TRACK.length))
  assert.match(r.headers['cache-control'], /immutable/)
})

test('mp3: Range bytes=0- — 206 и весь файл (так начинает Safari)', async () => {
  const r = await get('/assets/track.mp3', 'GET', { Range: 'bytes=0-' })
  assert.equal(r.status, 206)
  assert.equal(r.body, TRACK)
  assert.equal(r.headers['content-range'], `bytes 0-${TRACK.length - 1}/${TRACK.length}`)
})

test('mp3: Range bytes=0-1 — проба Safari, ровно два байта', async () => {
  const r = await get('/assets/track.mp3', 'GET', { Range: 'bytes=0-1' })
  assert.equal(r.status, 206)
  assert.equal(r.body, 'ab')
  assert.equal(r.headers['content-length'], '2')
})

test('mp3: кусок из середины и хвост', async () => {
  const mid = await get('/assets/track.mp3', 'GET', { Range: 'bytes=100-109' })
  assert.equal(mid.status, 206)
  assert.equal(mid.body, TRACK.slice(100, 110))
  assert.equal(mid.headers['content-range'], `bytes 100-109/${TRACK.length}`)
  const tail = await get('/assets/track.mp3', 'GET', { Range: 'bytes=-5' })
  assert.equal(tail.status, 206)
  assert.equal(tail.body, TRACK.slice(-5))
  const over = await get('/assets/track.mp3', 'GET', { Range: `bytes=${TRACK.length - 3}-${TRACK.length + 100}` })
  assert.equal(over.status, 206, 'конец за файлом — обрезается по файлу')
  assert.equal(over.body, TRACK.slice(-3))
})

test('mp3: диапазон за файлом — 416, процесс жив', async () => {
  const r = await get('/assets/track.mp3', 'GET', { Range: `bytes=${TRACK.length}-` })
  assert.equal(r.status, 416)
  assert.equal(r.headers['content-range'], `bytes */${TRACK.length}`)
  assert.equal(child.exitCode, null, `процесс завершился:\n${output}`)
})

test('mp3: непонятный Range — файл целиком; HEAD с Range — только заголовки', async () => {
  const multi = await get('/assets/track.mp3', 'GET', { Range: 'bytes=0-1,5-6' })
  assert.equal(multi.status, 200)
  assert.equal(multi.body, TRACK)
  const head = await get('/assets/track.mp3', 'HEAD', { Range: 'bytes=0-1' })
  assert.equal(head.status, 206)
  assert.equal(head.body, '')
  assert.equal(head.headers['content-length'], '2')
})

test('Range у не-медиа не меняет ответ', async () => {
  const r = await get('/ok.json', 'GET', { Range: 'bytes=0-1' })
  assert.equal(r.status, 200)
  assert.equal(r.body, '{"ok":true}')
  assert.equal(r.headers['accept-ranges'], undefined)
})
