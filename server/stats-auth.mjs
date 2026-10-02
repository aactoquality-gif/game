/** Stateless admin sessions; only OTP challenges and throttles live on disk (one replica). */
import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BlockList, isIP } from 'node:net'

export const SESSION_SECONDS = 8 * 3600
const WINDOW = 600
const COOKIE = '__Host-stats_session'
const MAX_RECORDS = 10000
const MAX_FILE = 4 * 1024 * 1024
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const digest = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url')
const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : ''
const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const split = (value = '') => value.split(',').map(x => x.trim()).filter(Boolean)
const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(JSON.stringify(value))
}

export function createClientIp(trusted = '') {
  const list = new BlockList()
  const normalize = ip => ip?.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip
  for (const cidr of split(trusted)) {
    const [ip, prefix, extra] = cidr.split('/')
    const family = isIP(ip)
    if (!family || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix))) throw new Error('Invalid TRUSTED_PROXY_CIDRS')
    if (prefix === undefined) list.addAddress(ip, family === 4 ? 'ipv4' : 'ipv6')
    else list.addSubnet(ip, Number(prefix), family === 4 ? 'ipv4' : 'ipv6')
  }
  const trustedIp = ip => isIP(ip) && list.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
  return req => {
    const remote = normalize(req.socket.remoteAddress) || 'unknown'
    const forwarded = req.headers['x-forwarded-for']
    if (!trustedIp(remote) || typeof forwarded !== 'string' || forwarded.length > 4096) return remote
    const chain = forwarded.split(',').map(x => normalize(x.trim()))
    if (chain.length > 32 || chain.some(ip => !isIP(ip))) return remote
    let current = remote
    for (let i = chain.length - 1; i >= 0 && trustedIp(current); i--) current = chain[i]
    return current
  }
}

export function createStatsAuth({ env = process.env, dataDir, now = () => Math.floor(Date.now() / 1000), fetchImpl = fetch }) {
  const secret = env.STATS_SESSION_SECRET || ''
  const emails = new Set(split(env.STATS_ADMIN_EMAILS).map(normalizeEmail).filter(validEmail))
  const telegramIds = new Set(split(env.STATS_ADMIN_TELEGRAM_IDS).filter(x => /^[1-9]\d*$/.test(x)))
  let origin = ''
  try {
    const url = new URL(env.STATS_ORIGIN)
    if (url.protocol === 'https:' && url.origin === env.STATS_ORIGIN) origin = url.origin
  } catch { /* fail closed */ }
  const enabled = Buffer.byteLength(secret) >= 32 && !!origin
  const emailEnabled = enabled && !!env.RESEND_API_KEY && !!env.STATS_EMAIL_FROM
  const file = join(dataDir, 'stats-auth-state.json')
  let state
  let broken = false
  const error = (res, status, code) => json(res, status, { error: code })
  const allowed = p => p.auth_method === 'telegram' ? telegramIds.has(p.user_id) : p.auth_method === 'email' && emails.has(p.user_id)

  function loadState() {
    if (state) return
    try {
      if (statSync(file).size > MAX_FILE) throw new Error('Oversized auth state')
      state = JSON.parse(readFileSync(file, 'utf8'))
      if (state.version !== 1 || !Array.isArray(state.rates) || !Array.isArray(state.codes) || state.rates.length + state.codes.length > MAX_RECORDS) throw new Error('Invalid auth state')
      if (state.rates.some(r => typeof r.key !== 'string' || !Array.isArray(r.times) || r.times.length > 5 || r.times.some(t => !Number.isSafeInteger(t)))) throw new Error('Invalid rate state')
      if (state.codes.some(c => !validEmail(c.email) || typeof c.id !== 'string' || typeof c.hash !== 'string' || !Number.isSafeInteger(c.expires) || typeof c.ready !== 'boolean')) throw new Error('Invalid OTP state')
    } catch (e) {
      if (e.code === 'ENOENT') state = { version: 1, rates: [], codes: [] }
      else { broken = true; throw e }
    }
  }

  // Synchronous transactions cannot interleave on the single Node event loop.
  // Persist + fsync before returning, including before consuming a code/issuing a cookie.
  function transaction(fn) {
    if (broken) throw new Error('Auth storage unavailable')
    let temp
    try {
      loadState()
      const draft = structuredClone(state)
      const time = now()
      draft.codes = draft.codes.filter(c => c.expires > time)
      draft.rates = draft.rates.map(r => ({ ...r, times: r.times.filter(t => t > time - WINDOW) })).filter(r => r.times.length)
      const result = fn(draft)
      if (draft.rates.length + draft.codes.length > MAX_RECORDS) throw new Error('Auth state capacity exceeded')
      const serialized = JSON.stringify(draft)
      if (Buffer.byteLength(serialized) > MAX_FILE) throw new Error('Auth state capacity exceeded')
      temp = `${file}.${randomBytes(12).toString('hex')}.tmp`
      const fd = openSync(temp, 'wx', 0o600)
      try { writeFileSync(fd, serialized); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temp, file)
      const directory = openSync(dirname(file), 'r')
      try { fsyncSync(directory) } finally { closeSync(directory) }
      state = draft
      return result
    } catch (e) {
      if (temp) { try { unlinkSync(temp) } catch { /* already renamed */ } }
      // Capacity is recoverable once records expire; I/O/corruption failures are not.
      if (e.message !== 'Auth state capacity exceeded') broken = true
      throw e
    }
  }

  function throttle(draft, action, ip, email) {
    const limit = action === 'request' ? 3 : 5
    const keys = [`${action}:ip:${digest(secret, ip)}`, `${action}:email:${digest(secret, email)}`]
    const records = keys.map(key => draft.rates.find(r => r.key === key) || { key, times: [] })
    const wait = Math.max(0, ...records.filter(r => r.times.length >= limit).map(r => r.times[0] + WINDOW - now()))
    if (wait) return wait
    for (const r of records) {
      if (!draft.rates.includes(r)) draft.rates.push(r)
      r.times.push(now())
    }
    return 0
  }

  function issue(res, userId, method, createdAt) {
    const payload = { user_id: userId, auth_method: method, created_at: createdAt, iat: now(), exp: createdAt + SESSION_SECONDS, iss: 'game-stats', aud: 'stats-admin' }
    const data = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`
    const token = `${data}.${digest(secret, data)}`
    json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${payload.exp - now()}` })
  }

  function authenticate(req) {
    if (!enabled) return null
    const cookies = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${COOKIE}=`))
    if (cookies.length !== 1) return null
    const token = cookies[0].slice(COOKIE.length + 1)
    if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null
    const [header, body, signature] = token.split('.')
    if (!equal(digest(secret, `${header}.${body}`), signature)) return null
    try {
      const h = JSON.parse(Buffer.from(header, 'base64url'))
      const p = JSON.parse(Buffer.from(body, 'base64url'))
      if (h.alg !== 'HS256' || h.typ !== 'JWT' || p.iss !== 'game-stats' || p.aud !== 'stats-admin' || typeof p.user_id !== 'string' || !allowed(p)) return null
      if (![p.created_at, p.iat, p.exp].every(Number.isSafeInteger) || p.created_at <= 0 || p.created_at > now() + 30 || p.iat > now() + 30 || p.iat < p.created_at - 30 || p.iat >= p.exp || p.exp !== p.created_at + SESSION_SECONDS || p.exp <= now()) return null
      return p
    } catch { return null }
  }

  function telegram(raw) {
    if (!env.BOT_TOKEN || typeof raw !== 'string' || raw.length > 16384) return null
    const params = new URLSearchParams(raw)
    if (new Set(params.keys()).size !== [...params.keys()].length) return null
    const hash = params.get('hash')
    if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return null
    params.delete('hash')
    const data = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n')
    const key = createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest()
    if (!equal(hash, createHmac('sha256', key).update(data).digest('hex'))) return null
    const date = Number(params.get('auth_date'))
    if (!Number.isSafeInteger(date) || date <= 0 || date > now() + 30 || date + SESSION_SECONDS <= now()) return null
    try {
      const user = JSON.parse(params.get('user'))
      if (!Number.isSafeInteger(user?.id) || user.id <= 0 || !telegramIds.has(String(user.id))) return null
      return { id: String(user.id), date }
    } catch { return null }
  }

  async function handle(req, res, action, body, ip) {
    if (!enabled) return error(res, 503, 'auth unavailable')
    if (req.headers.origin !== origin) return error(res, 403, 'invalid origin')
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return error(res, 415, 'expected json')
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error(res, 400, 'invalid request')
    if (action === 'telegram') {
      const user = telegram(body.initData)
      return user ? issue(res, user.id, 'telegram', user.date) : error(res, 403, 'access denied')
    }
    if (!emailEnabled) return error(res, 503, 'email unavailable')
    const email = normalizeEmail(body.email)
    if (!validEmail(email)) return error(res, 400, 'invalid email')
    try {
      if (action === 'email/request') {
        const code = String(randomInt(0, 1000000)).padStart(6, '0')
        const id = randomBytes(24).toString('hex')
        const wait = transaction(draft => {
          const wait = throttle(draft, 'request', ip, email)
          if (wait) return wait
          draft.codes = draft.codes.filter(c => c.email !== email)
          if (emails.has(email)) draft.codes.push({ email, id, hash: digest(secret, `otp:${email}:${id}:${code}`), expires: now() + WINDOW, ready: false })
          return 0
        })
        if (wait) return json(res, 429, { error: 'too many requests' }, { 'Retry-After': String(wait) })
        // Acknowledge before provider I/O so its latency cannot reveal the allowlist.
        json(res, 202, { ok: true })
        if (emails.has(email)) {
          let sent = false
          try {
            const response = await fetchImpl('https://api.resend.com/emails', {
              method: 'POST', signal: AbortSignal.timeout(10000),
              headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: env.STATS_EMAIL_FROM, to: [email], subject: 'Код входа в статистику', text: `Код входа: ${code}. Действует 10 минут. Никому не сообщайте код.` }),
            })
            sent = response.ok
            await response.body?.cancel()
          } catch { /* Same public response for unknown addresses and delivery failures. */ }
          transaction(draft => {
            const challenge = draft.codes.find(c => c.email === email && c.id === id)
            if (challenge) {
              if (sent) challenge.ready = true
              else draft.codes = draft.codes.filter(c => c !== challenge)
            }
          })
          if (!sent) console.warn('[stats-auth] email delivery failed')
        }
        return
      }
      if (action === 'email/verify') {
        const result = transaction(draft => {
          const wait = throttle(draft, 'verify', ip, email)
          if (wait) return { wait }
          const challenge = draft.codes.find(c => c.email === email)
          const valid = emails.has(email) && challenge?.ready && typeof body.code === 'string' && /^\d{6}$/.test(body.code) && equal(challenge.hash, digest(secret, `otp:${email}:${challenge.id}:${body.code}`))
          if (valid) draft.codes = draft.codes.filter(c => c !== challenge)
          return { valid }
        })
        if (result.wait) return json(res, 429, { error: 'too many requests' }, { 'Retry-After': String(result.wait) })
        return result.valid ? issue(res, email, 'email', now()) : error(res, 403, 'invalid code')
      }
      return error(res, 404, 'not found')
    } catch {
      console.warn('[stats-auth] storage unavailable')
      if (!res.headersSent) return error(res, 503, 'auth unavailable')
    }
  }

  function authorize(req, res, onLogin) {
    if (authenticate(req)) return true
    if (onLogin) onLogin()
    else error(res, 401, 'authentication required')
    return false
  }
  return { handle, authenticate, authorize, enabled }
}
