import assert from 'node:assert/strict'
import { join } from 'node:path'
import { startStatsFixture } from '../tests/stats-fixture.mjs'

export async function checkStatsUi(browser, out) {
  const fixture = await startStatsFixture()
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const requests = []
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('request', r => requests.push(r.url()))
  await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.Telegram={WebApp:{initData:""}}' }))
  try {
    for (const route of ['/api/stats?format=json', '/api/stats/download', '/api/events.jsonl']) {
      assert.equal((await context.request.get(fixture.origin + route)).status(), 401)
    }
    await page.goto(`${fixture.origin}/api/stats?key=legacy-secret&story=namertvo&episode=1`)
    await page.getByRole('heading', { name: 'Вход в статистику' }).waitFor()
    assert.ok(!page.url().includes('key='))
    assert.ok(!(await page.content()).includes('legacy-secret'))
    await page.screenshot({ path: join(out, 'stats-login.png'), fullPage: true })
    await page.getByLabel('Email администратора').fill('admin@example.com')
    await page.getByRole('button', { name: 'Получить код' }).click()
    await page.getByRole('status').filter({ hasText: 'Если адресу' }).waitFor()
    const mail = await fixture.waitForMail()
    assert.equal(fixture.mails.length, 1)
    const code = mail.text.match(/\b\d{6}\b/)[0]
    await page.getByLabel('Код из письма').fill(code)
    await page.getByLabel('Код из письма').press('Enter')
    await page.getByRole('heading', { name: /Г1 ·/ }).waitFor()
    const cookies = await context.cookies()
    const cookie = cookies.find(c => c.name === '__Host-stats_session')
    assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict' && cookie.path === '/')
    assert.ok(!(await page.evaluate(() => document.cookie)).includes('__Host-stats_session'))
    assert.ok(!(await page.content()).includes(cookie.value))
    assert.ok(!requests.some(url => url.includes(code) || url.includes(cookie.value)))
    assert.ok(!page.url().includes('key='))
    assert.equal(await page.locator('input[type=hidden]').count(), 0)
    await page.getByLabel('с даты').fill('2026-01-01')
    await page.getByRole('button', { name: 'Применить' }).click()
    await page.waitForURL(/from=2026-01-01/)
    assert.ok(!page.url().includes('key='))
    assert.equal((await context.request.get(`${fixture.origin}/api/stats?format=json`)).status(), 200)
    assert.equal((await context.request.get(`${fixture.origin}/api/events.jsonl`)).status(), 200)
    const downloaded = page.waitForEvent('download')
    await page.getByRole('link', { name: 'скачать сырые события' }).click()
    assert.equal((await downloaded).suggestedFilename(), 'events.jsonl')
    await page.screenshot({ path: join(out, 'stats-report.png'), fullPage: true })
    assert.equal((await context.request.post(`${fixture.origin}/api/stats/auth/email/request`, { data: { email: 'admin@example.com' }, headers: { Origin: 'https://evil.example' } })).status(), 403)
    await context.clearCookies()
    assert.equal((await context.request.get(`${fixture.origin}/api/stats/download`)).status(), 401)
    await context.unroute('https://telegram.org/js/telegram-web-app.js')
    await context.route('https://telegram.org/js/telegram-web-app.js', route => route.fulfill({ contentType: 'application/javascript', body: `window.Telegram={WebApp:{initData:${JSON.stringify(fixture.initData())},isVersionAtLeast:()=>false}}` }))
    await page.goto(`${fixture.origin}/api/stats`)
    await page.getByRole('heading', { name: /Г1 ·/ }).waitFor()
    // Simulate a browser refusing cookies after a successful Telegram authentication.
    await context.clearCookies()
    let attempts = 0
    await page.route('**/api/stats/auth/telegram', async route => {
      attempts++
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await page.goto(`${fixture.origin}/api/stats`)
    await page.getByRole('status').filter({ hasText: 'Браузер не сохранил' }).waitFor()
    assert.equal(attempts, 1)
    assert.equal(await page.getByRole('link', { name: 'Открыть в браузере' }).getAttribute('href'), `${fixture.origin}/api/stats`)
    await page.screenshot({ path: join(out, 'stats-cookie-blocked.png'), fullPage: true })
    assert.deepEqual(errors, [])
    console.log('✓ stats: HTTPS OTP + Telegram, protected routes, clean URLs, download and blocked-cookie fallback')
  } finally {
    await context.close()
    await fixture.close()
  }
}
