import { createServer as createHttpsServer } from 'node:https'
import { createServer, request } from 'node:http'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHmac, randomBytes } from 'node:crypto'
import { once } from 'node:events'

export async function startStatsFixture(port = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'stats-https-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  const reserve = createServer()
  reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening')
  const backendPort = reserve.address().port
  await new Promise(resolve => reserve.close(resolve))
  const proxy = createHttpsServer({ key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) }, (req, res) => {
    const upstream = request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, reply => {
      res.writeHead(reply.statusCode, reply.headers); reply.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  proxy.listen(port, '127.0.0.1'); await once(proxy, 'listening')
  const origin = `https://localhost:${proxy.address().port}`
  const botToken = randomBytes(24).toString('hex')
  const mails = []
  writeFileSync(join(dir, 'events.jsonl'), '')
  const child = spawn(process.execPath, ['--import', resolve('tests/resend-fixture.mjs'), 'server/index.mjs'], {
    env: { ...process.env, PORT: String(backendPort), DATA_DIR: dir, STATS_ORIGIN: origin, STATS_SESSION_SECRET: randomBytes(32).toString('hex'), BOT_TOKEN: botToken, STATS_ADMIN_TELEGRAM_IDS: '123', STATS_ADMIN_EMAILS: 'admin@example.com', RESEND_API_KEY: 'synthetic-test-key', STATS_EMAIL_FROM: 'Stats <stats@example.com>', TRUSTED_PROXY_CIDRS: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  child.on('message', message => { if (message.type === 'mail') mails.push(message.mail) })
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Fixture server startup timed out')), 10000)
    child.stdout.on('data', data => { if (data.toString().includes('Game server')) { clearTimeout(timer); resolveReady() } })
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture server exited')) })
  })
  return {
    origin, mails,
    async waitForMail() {
      if (!mails.length) await once(child, 'message', { signal: AbortSignal.timeout(5000) })
      return mails.at(-1)
    },
    initData() {
      const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 123 }) })
      const key = createHmac('sha256', 'WebAppData').update(botToken).digest()
      params.set('hash', createHmac('sha256', key).update([...params].map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'))
      return params.toString()
    },
    async close() {
      const exited = once(child, 'exit'); child.kill(); await exited
      await new Promise(resolve => proxy.close(resolve))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
