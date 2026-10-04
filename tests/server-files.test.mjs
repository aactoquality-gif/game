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
function get(path, method = 'GET') {
  return new Promise((done, fail) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, (res) => {
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
