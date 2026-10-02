import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHmac } from 'node:crypto'
import { createStatsAuth, createClientIp, SESSION_SECONDS } from '../server/stats-auth.mjs'

const env = { STATS_SESSION_SECRET: 'test-secret-only-'.repeat(4), STATS_ORIGIN: 'https://stats.example', BOT_TOKEN: 'test-bot', STATS_ADMIN_EMAILS: 'admin@example.com', STATS_ADMIN_TELEGRAM_IDS: '123', RESEND_API_KEY: 'fake', STATS_EMAIL_FROM: 'Stats <stats@example.com>' }
function setup(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'stats-auth-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let clock = 1800000000
  const letters = []
  const opts = { env: { ...env, ...overrides }, dataDir: dir, now: () => clock, fetchImpl: async (url, options) => { letters.push({ url, ...JSON.parse(options.body) }); return { ok: true } } }
  return { dir, letters, opts, auth: createStatsAuth(opts), advance: n => { clock += n }, now: () => clock }
}
function response() {
  return { writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true }, end(body) { this.body = body }, cookie() { return this.headers?.['Set-Cookie']?.split(';')[0] } }
}
async function call(auth, action, body, ip = '192.0.2.1', headers = {}) {
  const res = response()
  await auth.handle({ headers: { origin: env.STATS_ORIGIN, 'content-type': 'application/json', ...headers } }, res, action, body, ip)
  return res
}
function initData(date, id = 123) {
  const params = new URLSearchParams({ auth_date: String(date), user: JSON.stringify({ id }), query_id: 'test' })
  const text = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest()
  params.set('hash', createHmac('sha256', secret).update(text).digest('hex'))
  return params.toString()
}
const session = (auth, cookie) => auth.authenticate({ headers: { cookie } })
const email = 'admin@example.com'
const request = auth => call(auth, 'email/request', { email })
const otp = f => f.letters.at(-1).text.match(/\b\d{6}\b/)[0]

test('Telegram session cookie is strict, anchored, survives restart and checks allowlist', async t => {
  const f = setup(t)
  const res = await call(f.auth, 'telegram', { initData: initData(f.now() - 60) })
  assert.equal(res.status, 200)
  assert.match(res.headers['Set-Cookie'], /; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=28740$/)
  assert.equal(res.body, '{"ok":true}')
  assert.ok(session(createStatsAuth(f.opts), res.cookie()))
  assert.equal(session(createStatsAuth({ ...f.opts, env: { ...env, STATS_ADMIN_TELEGRAM_IDS: '' } }), res.cookie()), null)
  f.advance(SESSION_SECONDS - 61)
  assert.ok(session(f.auth, res.cookie()))
  f.advance(1)
  assert.equal(session(f.auth, res.cookie()), null)
  assert.equal((await call(f.auth, 'telegram', { initData: initData(f.now() - SESSION_SECONDS) })).status, 403)
})

test('Telegram rejects unsigned, tampered, duplicate, future and unauthorized identities', async t => {
  const f = setup(t)
  for (const raw of ['user={"id":123}', initData(f.now()).replace('test', 'changed'), initData(f.now()) + '&auth_date=1', initData(f.now() + 31), initData(f.now(), 321), initData(f.now(), '123')]) {
    assert.equal((await call(f.auth, 'telegram', { initData: raw })).status, 403)
  }
  const off = createStatsAuth({ ...f.opts, env: { ...env, BOT_TOKEN: '' } })
  assert.equal((await call(off, 'telegram', { initData: initData(f.now()) })).status, 403)
})

test('JWT rejects tampering, wrong algorithm/purpose/claims and duplicate cookies', async t => {
  const f = setup(t)
  const res = await call(f.auth, 'telegram', { initData: initData(f.now()) })
  const cookie = res.cookie()
  assert.equal(session(f.auth, cookie + '; ' + cookie), null)
  const [name, token] = cookie.split('=')
  const [h, p] = token.split('.')
  const payload = JSON.parse(Buffer.from(p, 'base64url'))
  const sign = (header, data) => {
    const value = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(data)).toString('base64url')}`
    return `${name}=${value}.${createHmac('sha256', env.STATS_SESSION_SECRET).update(value).digest('base64url')}`
  }
  for (const change of [{ exp: payload.exp + 1 }, { aud: 'other' }, { iss: 'other' }, { iat: f.now() + 31 }, { created_at: 0 }, { auth_method: 'other' }, { user_id: 123 }]) {
    assert.equal(session(f.auth, sign({ alg: 'HS256', typ: 'JWT' }, { ...payload, ...change })), null)
  }
  assert.equal(session(f.auth, sign({ alg: 'none', typ: 'JWT' }, payload)), null)
  assert.equal(session(f.auth, `${name}=${h}.${p}.invalid`), null)
})

test('OTP sends through Resend, normalizes email, stores no plaintext, consumes exactly once', async t => {
  const f = setup(t)
  assert.equal((await call(f.auth, 'email/request', { email: ' ADMIN@EXAMPLE.COM ' })).status, 202)
  const code = otp(f)
  assert.equal(f.letters[0].url, 'https://api.resend.com/emails')
  assert.deepEqual(f.letters[0].to, [email])
  assert.ok(!readFileSync(join(f.dir, 'stats-auth-state.json'), 'utf8').includes(code))
  const restarted = createStatsAuth(f.opts)
  const results = await Promise.all([call(restarted, 'email/verify', { email, code }), call(restarted, 'email/verify', { email, code })])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 403])
  const cookie = results.find(r => r.status === 200).cookie()
  assert.equal(session(restarted, cookie).auth_method, 'email')
  f.advance(SESSION_SECONDS)
  assert.equal(session(restarted, cookie), null)
})

test('OTP expires, replacement invalidates previous code, verification budget is not reset', async t => {
  const f = setup(t)
  await request(f.auth)
  const first = otp(f)
  await request(f.auth)
  // The replacement challenge is different even in the unlikely event of identical random codes.
  const state = JSON.parse(readFileSync(join(f.dir, 'stats-auth-state.json')))
  assert.equal(state.codes.length, 1)
  if (first !== otp(f)) assert.equal((await call(f.auth, 'email/verify', { email, code: first })).status, 403)
  f.advance(600)
  assert.equal((await call(f.auth, 'email/verify', { email, code: otp(f) })).status, 403)
  for (let i = 0; i < 4; i++) assert.equal((await call(f.auth, 'email/verify', { email, code: 'bad' })).status, 403)
  await request(f.auth)
  assert.equal((await call(f.auth, 'email/verify', { email, code: otp(f) })).status, 429)
})

test('sliding limits persist across restart, constrain IP and email independently', async t => {
  const f = setup(t)
  for (let i = 0; i < 3; i++) assert.equal((await request(f.auth)).status, 202)
  const restarted = createStatsAuth(f.opts)
  const blocked = await request(restarted)
  assert.equal(blocked.status, 429); assert.equal(blocked.headers['Retry-After'], '600')
  assert.equal((await call(restarted, 'email/request', { email }, '192.0.2.2')).status, 429)
  assert.equal((await call(restarted, 'email/request', { email: 'other@example.com' })).status, 429)
  f.advance(599); assert.equal((await request(restarted)).status, 429)
  f.advance(1); assert.equal((await request(restarted)).status, 202)
  for (let i = 0; i < 5; i++) assert.equal((await call(restarted, 'email/verify', { email, code: 'bad' })).status, 403)
  assert.equal((await call(restarted, 'email/verify', { email, code: 'bad' }, '192.0.2.2')).status, 429)
  assert.equal((await call(restarted, 'email/verify', { email: 'other@example.com', code: 'bad' })).status, 429)
})

test('unknown emails and failed delivery have generic responses and cannot create sessions', async t => {
  const f = setup(t)
  assert.equal((await call(f.auth, 'email/request', { email: 'unknown@example.com' })).body, '{"ok":true}')
  assert.equal(f.letters.length, 0)
  for (const fetchImpl of [async () => ({ ok: false }), async () => { throw new Error('timeout') }]) {
    const auth = createStatsAuth({ ...f.opts, fetchImpl })
    assert.equal((await request(auth)).status, 202)
    assert.equal(JSON.parse(readFileSync(join(f.dir, 'stats-auth-state.json'))).codes.length, 0)
  }
})

test('corrupt and unwritable state fail closed; configuration, origin and JSON are required', async t => {
  const f = setup(t)
  assert.equal((await call(f.auth, 'email/request', { email }, undefined, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await call(f.auth, 'email/request', { email }, undefined, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await request(createStatsAuth({ ...f.opts, env: { ...env, STATS_SESSION_SECRET: '' } }))).status, 503)
  writeFileSync(join(f.dir, 'stats-auth-state.json'), '{broken')
  assert.equal((await request(f.auth)).status, 503)
  rmSync(join(f.dir, 'stats-auth-state.json'))
  assert.equal((await request(f.auth)).status, 503)
  mkdirSync(join(f.dir, 'stats-auth-state.json'))
  assert.equal((await request(createStatsAuth(f.opts))).status, 503)
})

test('proxy trust resists forged forwarding headers and handles IPv4/IPv6 chains', () => {
  const req = (remote, forwarded) => ({ socket: { remoteAddress: remote }, headers: { 'x-forwarded-for': forwarded } })
  assert.equal(createClientIp()(req('192.0.2.1', '1.2.3.4')), '192.0.2.1')
  const ip = createClientIp('10.0.0.0/8,::1/128')
  assert.equal(ip(req('10.0.0.1', '1.2.3.4, 192.0.2.1')), '192.0.2.1')
  assert.equal(ip(req('::ffff:10.0.0.1', '192.0.2.1, 10.0.0.2')), '192.0.2.1')
  assert.equal(ip(req('::1', '2001:db8::1')), '2001:db8::1')
  assert.equal(ip(req('10.0.0.1', 'invalid')), '10.0.0.1')
  assert.throws(() => createClientIp('bad/123'))
})

test('disk write failure cannot issue a session and remains closed after the failure', async t => {
  const f = setup(t)
  await request(f.auth)
  const code = otp(f)
  rmSync(f.dir, { recursive: true })
  const failed = await call(f.auth, 'email/verify', { email, code })
  assert.equal(failed.status, 503)
  assert.equal(failed.cookie(), undefined)
  mkdirSync(f.dir)
  assert.equal((await request(f.auth)).status, 503)
})

test('out-of-order email delivery cannot reactivate a replaced challenge', async t => {
  const f = setup(t)
  const pending = []
  const letters = []
  const auth = createStatsAuth({ ...f.opts, fetchImpl: async (_url, options) => {
    letters.push(JSON.parse(options.body))
    return await new Promise(resolve => pending.push(resolve))
  } })
  const first = request(auth)
  const second = request(auth)
  assert.equal(pending.length, 2)
  pending[1]({ ok: true }); await second
  const current = JSON.parse(readFileSync(join(f.dir, 'stats-auth-state.json'))).codes[0]
  pending[0]({ ok: true }); await first
  assert.deepEqual(JSON.parse(readFileSync(join(f.dir, 'stats-auth-state.json'))).codes[0], current)
  assert.equal((await call(auth, 'email/verify', { email, code: letters[1].text.match(/\b\d{6}\b/)[0] })).status, 200)
})
