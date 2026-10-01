/**
 * Автопроверка интерфейса — `npm run check:ui`
 *
 * Берёт прод-сборку (dist), поднимает её через vite preview и проходит игру в настоящем
 * Chromium: 3 размера экрана × 2 режима.
 *   браузер  — игра открыта не из Telegram (отладка, будущая веб-версия);
 *   telegram — имитация Telegram WebApp: подписанный initData, системная «Назад»,
 *              облачное хранилище, отступ под home bar.
 *
 * ✗ ошибка    — проверка красная (код выхода 1).
 * ! замечание — не ломает проверку, но попадает в отчёт: это кандидаты в отдельные задачи.
 *
 * Отчёт со скриншотами: .checks/ui/report.html
 * Браузер ищется так: CHROME_PATH → Chromium Playwright → Google Chrome → Microsoft Edge.
 */

import { preview } from 'vite'
import { chromium } from 'playwright-core'
import { gzipSync } from 'node:zlib'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const OUT = resolve('.checks/ui')
const DIST_ASSETS = resolve('dist/assets')
const BUDGET_KB = 50 // JS + CSS, gzip — бюджет производительности (А5)
const MIN_TAP = 44 // минимальная зона касания, px
const TAP_GUARD_MS = 350 // защита от двойного тапа — как в src/ui/reading.ts
const SAFE_BOTTOM = 34 // home bar iPhone в режиме Telegram

const VIEWPORTS = [
  { id: '320', width: 320, height: 568, mobile: true },
  { id: '390', width: 390, height: 844, mobile: true },
  { id: '1440', width: 1440, height: 900, mobile: false },
]
const MODES = ['browser', 'telegram']
/** Эпизод целиком проходим на основном размере; на остальных — до первого выбора и чуть дальше */
const FULL_RUN = '390'

/** Быстрый прогон части сценариев: CHECK_ONLY=390-telegram,320-browser */
const ONLY = process.env.CHECK_ONLY ? process.env.CHECK_ONLY.split(',').map((s) => s.trim()) : null

const MODE_LABEL = { browser: 'браузер', telegram: 'Telegram' }
const REQUIRED_EVENTS = ['episode_enter', 'episode_start', 'screen_view', 'choice_made', 'story_view', 'menu_view']
const TG_CALLS = ['ready', 'expand', 'disableVerticalSwipes', 'setHeaderColor', 'setBackgroundColor', 'CloudStorage.setItem']

// ---------------------------------------------------------------------------
// Имитация telegram-web-app.js. Выполняется в странице, поэтому без замыканий на Node.
// Вне Telegram настоящий скрипт тоже создаёт WebApp — с пустым initData и версией 6.0.
// ---------------------------------------------------------------------------

function telegramMock(cfg) {
  const calls = []
  const backHandlers = new Set()
  const STORE = '__check_tg_cloud'
  const load = () => {
    try {
      return JSON.parse(sessionStorage.getItem(STORE) || '{}')
    } catch {
      return {}
    }
  }
  const save = (data) => sessionStorage.setItem(STORE, JSON.stringify(data))
  const later = (fn) => setTimeout(fn, 5)
  const log = (name) => () => {
    calls.push(name)
  }
  const atLeast = (version) => {
    const a = cfg.version.split('.').map(Number)
    const b = String(version).split('.').map(Number)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0)
      if (d) return d > 0
    }
    return true
  }
  const back = {
    isVisible: false,
    show() {
      this.isVisible = true
    },
    hide() {
      this.isVisible = false
    },
    onClick(fn) {
      backHandlers.add(fn)
    },
    offClick(fn) {
      backHandlers.delete(fn)
    },
  }

  window.Telegram = {
    WebApp: {
      initData: cfg.initData,
      initDataUnsafe: cfg.initData ? { user: { id: 1, first_name: 'Check' } } : {},
      version: cfg.version,
      platform: cfg.platform,
      colorScheme: 'dark',
      themeParams: {},
      isExpanded: true,
      viewportHeight: innerHeight,
      viewportStableHeight: innerHeight,
      isVersionAtLeast: atLeast,
      ready: log('ready'),
      expand: log('expand'),
      close: log('close'),
      setHeaderColor: log('setHeaderColor'),
      setBackgroundColor: log('setBackgroundColor'),
      disableVerticalSwipes: log('disableVerticalSwipes'),
      onEvent() {},
      offEvent() {},
      HapticFeedback: { impactOccurred: log('haptic'), notificationOccurred: log('haptic'), selectionChanged: log('haptic') },
      CloudStorage: {
        setItem(key, value, cb) {
          const d = load()
          d[key] = String(value)
          save(d)
          calls.push('CloudStorage.setItem')
          later(() => cb && cb(null, true))
        },
        getItem(key, cb) {
          const d = load()
          later(() => cb(null, d[key] ?? ''))
        },
        getItems(keys, cb) {
          const d = load()
          later(() => cb(null, Object.fromEntries(keys.map((k) => [k, d[k] ?? '']))))
        },
        removeItem(key, cb) {
          const d = load()
          delete d[key]
          save(d)
          later(() => cb && cb(null, true))
        },
        getKeys(cb) {
          const d = load()
          later(() => cb(null, Object.keys(d)))
        },
      },
      BackButton: back,
      MainButton: { text: '', isVisible: false, isActive: true, show() {}, hide() {}, setText() {}, onClick() {}, offClick() {} },
    },
  }

  if (cfg.initData) {
    const s = document.documentElement.style
    s.setProperty('--tg-safe-area-inset-top', '0px')
    s.setProperty('--tg-safe-area-inset-bottom', `${cfg.safeBottom}px`)
    s.setProperty('--tg-content-safe-area-inset-top', '0px')
    s.setProperty('--tg-viewport-height', `${innerHeight}px`)
    s.setProperty('--tg-viewport-stable-height', `${innerHeight}px`)
  }

  window.__check = {
    calls,
    pressBack: () => [...backHandlers].forEach((fn) => fn()),
    backVisible: () => back.isVisible,
  }
}

function fakeInitData() {
  const user = encodeURIComponent(JSON.stringify({ id: 1, first_name: 'Check' }))
  return `query_id=CHECK&user=${user}&auth_date=${Math.floor(Date.now() / 1000)}&hash=${'0'.repeat(64)}`
}

// ---------------------------------------------------------------------------
// Чтение состояния экрана (выполняется в странице)
// ---------------------------------------------------------------------------

function readScreen() {
  const q = (s) => document.querySelector(s)
  const stage = q('.stage')
  let screen = 'unknown'
  if (q('.screen--menu')) screen = 'menu'
  else if (q('.screen--story')) screen = 'story'
  else if (stage) {
    if (q('.end-card')) screen = 'end'
    else if (q('.choices')) screen = 'choice'
    else if (stage.classList.contains('stage--push')) screen = 'push'
    else screen = 'text'
  } else if (q('.loading')) screen = 'loading'
  else if (q('.error')) screen = 'error'
  const textEl = q('.end-card__title') || q('.push__text') || q('.panel .text')
  return { screen, text: textEl ? textEl.textContent.trim() : '', overlay: !!q('.layer') }
}

function auditLayout({ minTap, safeBottom }) {
  const vw = innerWidth
  const vh = innerHeight
  const doc = document.scrollingElement
  const label = (el) => {
    const cls = [...el.classList].slice(0, 2).join('.')
    return cls ? `.${cls}` : el.tagName.toLowerCase()
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < vh
  }

  const smallTargets = []
  const cutOff = []
  for (const el of document.querySelectorAll('button, a[href], [role="button"], input, select, textarea')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue
    const r = el.getBoundingClientRect()
    if (r.width < minTap || r.height < minTap) smallTargets.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)}`)
    if (r.left < -1 || r.right > vw + 1) cutOff.push(label(el))
  }
  // Блоки текста тоже: экраны обрезают лишнее (overflow: hidden), и документ при этом не скроллится
  for (const el of document.querySelectorAll('.panel, .choices, .push, .end-card, .continue-card, .folder, .episodes, .sheet, .dialog-box')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.left < -1 || r.right > vw + 1) cutOff.push(label(el))
  }

  // Под home bar не должно уходить ничего из экрана чтения (прокручиваемые экраны — не в счёт)
  const underHomeBar = []
  if (safeBottom > 0) {
    for (const el of document.querySelectorAll('.stage button, .stage .dialog, .stage .choices, .stage .push')) {
      if (!visible(el)) continue
      if (el.getBoundingClientRect().bottom > vh - safeBottom + 1) underHomeBar.push(label(el))
    }
  }

  return {
    hScroll: doc.scrollWidth > vw + 1,
    vScroll: doc.scrollHeight > vh + 1,
    smallTargets: [...new Set(smallTargets)],
    cutOff: [...new Set(cutOff)],
    underHomeBar: [...new Set(underHomeBar)],
  }
}

// ---------------------------------------------------------------------------
// Один прогон: размер экрана × режим
// ---------------------------------------------------------------------------

async function runCase(browser, baseUrl, apiLog, vp, mode) {
  const id = `${vp.id}-${mode}`
  const full = vp.id === FULL_RUN
  const res = { id, vp, mode, full, errors: [], warnings: [], passed: [], shots: [], screensSeen: 0 }
  const fail = (msg) => res.errors.push(msg)
  const warn = (msg) => {
    if (!res.warnings.includes(msg)) res.warnings.push(msg)
  }
  const expect = (cond, msg) => (cond ? res.passed.push(msg) : fail(msg))

  const safeBottom = mode === 'telegram' && vp.mobile ? SAFE_BOTTOM : 0
  const cfg =
    mode === 'telegram'
      ? { initData: fakeInitData(), version: '8.0', platform: vp.mobile ? 'ios' : 'tdesktop', safeBottom }
      : { initData: '', version: '6.0', platform: 'unknown', safeBottom: 0 }

  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'ru-RU',
  })

  apiLog.length = 0 // пачки аналитики этого прогона (принимает заглушка /api в preview-сервере)
  await context.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: `(${telegramMock})(${JSON.stringify(cfg)})` }),
  )

  const page = await context.newPage()
  page.on('pageerror', (e) => fail(`JS-ошибка: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (m.text().startsWith('Failed to load resource')) return // разбирается в обработчике response
    fail(`console.error: ${m.text()}`)
  })
  page.on('requestfailed', (r) => {
    if (r.url().startsWith('data:')) return
    // sendBeacon при перезагрузке страница «отменяет», но браузер его доставляет —
    // доставку проверяет блок аналитики по тому, что принял сервер
    if (new URL(r.url()).pathname.startsWith('/api/') && r.failure()?.errorText === 'net::ERR_ABORTED') return
    fail(`запрос не прошёл: ${r.url()} (${r.failure()?.errorText})`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) warn(`файл не найден (${r.status()}): ${new URL(r.url()).pathname}`)
  })

  const state = () => page.evaluate(readScreen)
  const waitFor = async (pred, what, timeout = 8000) => {
    const start = Date.now()
    let s
    while (Date.now() - start < timeout) {
      s = await state()
      if (pred(s)) return s
      await page.waitForTimeout(100)
    }
    throw new Error(`не дождались: ${what} (на экране: ${s?.screen})`)
  }
  const markStage = () =>
    page.evaluate(() => {
      const s = document.querySelector('.stage')
      if (s) s.dataset.checkSeen = '1'
    })
  const stageReplaced = (timeout) =>
    page
      .waitForFunction(() => !document.querySelector('.stage')?.dataset.checkSeen, null, { timeout })
      .then(
        () => true,
        () => false,
      )
  const seen = new Set()
  const remember = (s) => s.text && seen.add(s.text)

  /** Тап по сцене (выше панели текста). true — экран сменился, false — панель докрутилась */
  const tapStage = async () => {
    await markStage()
    const box = await page.locator('.stage').boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.35)
    const replaced = await stageReplaced(1500)
    await page.waitForTimeout(TAP_GUARD_MS + 50)
    return replaced
  }
  const pickFirstChoice = async () => {
    await markStage()
    await page.locator('.choices .choice:not([disabled])').first().click()
    const replaced = await stageReplaced(2500)
    await page.waitForTimeout(TAP_GUARD_MS + 50)
    return replaced
  }
  const back = () => (mode === 'telegram' ? page.evaluate(() => window.__check.pressBack()) : page.keyboard.press('Escape'))

  const audit = async (name) => {
    const m = await page.evaluate(auditLayout, { minTap: MIN_TAP, safeBottom })
    expect(!m.hScroll, `${name}: нет горизонтальной прокрутки`)
    expect(!m.vScroll, `${name}: документ зафиксирован, прокручивается только контент`)
    expect(m.cutOff.length === 0, `${name}: кнопки и блоки текста не обрезаны краем экрана${m.cutOff.length ? ` — ${m.cutOff.join(', ')}` : ''}`)
    if (m.smallTargets.length) warn(`${name}: зона касания меньше ${MIN_TAP} px — ${m.smallTargets.join('; ')}`)
    if (m.underHomeBar.length) warn(`${name}: уходит под home bar (${SAFE_BOTTOM} px) — ${m.underHomeBar.join(', ')}`)
    const file = `${id}-${name}.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name, file })
  }

  try {
    // 1. Первый запуск → сразу эпизод (гипотеза H3)
    await page.goto(baseUrl)
    let s = await waitFor((x) => !['unknown', 'loading'].includes(x.screen), 'первый экран')
    expect(['text', 'push', 'choice'].includes(s.screen), 'первый запуск открывает эпизод, а не меню')
    await page.waitForTimeout(TAP_GUARD_MS + 100)
    remember(s)
    await audit('reading')

    // 2. Тапами до первого выбора
    for (let i = 0; i < 80 && s.screen !== 'choice' && s.screen !== 'end'; i++) {
      await tapStage()
      s = await state()
      remember(s)
    }
    expect(s.screen === 'choice', 'тапы листают эпизод до первого выбора')
    await audit('choice')
    const beforePick = s.text
    expect(await pickFirstChoice(), 'выбор принимается и ведёт дальше')
    s = await state()
    remember(s)
    expect(s.text !== beforePick, 'после выбора открылся другой экран')

    // 3. Меню паузы и «Назад» закрывает сначала его
    await page.locator('.hud button').first().click()
    await waitFor((x) => x.overlay, 'меню паузы')
    await page.waitForTimeout(250)
    await audit('pause')
    await back()
    await waitFor((x) => !x.overlay, 'закрытие меню паузы')
    expect((await state()).screen === s.screen, '«Назад» закрывает меню паузы и оставляет в эпизоде')

    // 4. Полный эпизод — до карточки конца; иначе ещё один экран
    if (full) {
      for (let i = 0; i < 200 && s.screen !== 'end'; i++) {
        if (s.screen === 'choice') await pickFirstChoice()
        else await tapStage()
        s = await state()
        remember(s)
      }
      expect(s.screen === 'end', 'эпизод проходится до карточки конца')
      await audit('end')
    } else {
      await tapStage()
      s = await state()
      remember(s)
    }
    const lastText = s.text
    const lastScreen = s.screen

    if (mode === 'telegram') expect(await page.evaluate(() => window.__check.backVisible()), 'Telegram: системная «Назад» видна в эпизоде')

    // 5. «Назад»: эпизод → история → меню
    await back()
    await waitFor((x) => x.screen === 'story', 'экран истории')
    await page.waitForTimeout(250)
    await audit('story')
    await back()
    s = await waitFor((x) => x.screen === 'menu', 'главное меню')
    await page.waitForTimeout(250)
    await audit('menu')
    if (mode === 'telegram') expect(!(await page.evaluate(() => window.__check.backVisible())), 'Telegram: на главном меню «Назад» скрыта')
    // «Продолжить» — только если есть недочитанный эпизод (src/ui/menu.ts)
    const continueCards = await page.locator('.continue-card').count()
    if (full) expect(continueCards === 0, 'эпизод дочитан — карточки «Продолжить» нет')
    else expect(continueCards === 1, 'в меню есть карточка «Продолжить»')
    expect((await page.locator('.folder').count()) >= 1, 'в меню есть каталог историй')

    // 6. Аналитика: сворачивание досылает пачку
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.waitForTimeout(400)
    const payloads = [...apiLog]
    expect(payloads.every((p) => !p.invalid), 'аналитика: пачки событий — валидный JSON')
    const events = payloads.flatMap((p) => p.events ?? [])
    const names = new Set(events.map((e) => e.event))
    for (const need of REQUIRED_EVENTS) expect(names.has(need), `аналитика: ${need}`)
    if (full) expect(names.has('episode_complete'), 'аналитика: episode_complete')
    const platforms = [...new Set(events.map((e) => e.platform))]
    expect(platforms.length === 1 && platforms[0] === mode, `аналитика: платформа во всех событиях — ${mode} (есть: ${platforms.join(', ') || 'нет событий'})`)
    if (mode === 'telegram') expect(payloads.length > 0 && payloads.every((p) => p.initData), 'аналитика: пачки идут с подписанным initData')

    // 7. Telegram: обязательные вызовы Mini App
    if (mode === 'telegram') {
      const calls = await page.evaluate(() => window.__check.calls)
      for (const need of TG_CALLS) expect(calls.includes(need), `Telegram: ${need}`)
    }

    // 8. Перезапуск: прогресс на месте
    await page.reload()
    s = await waitFor((x) => !['unknown', 'loading'].includes(x.screen), 'экран после перезапуска')
    expect(s.screen === 'menu', 'повторный запуск открывает меню')
    if (full) {
      await page.waitForTimeout(250)
      await page.locator('.folder:not(.folder--soon)').first().click()
      await waitFor((x) => x.screen === 'story', 'экран истории после перезапуска')
      expect((await page.locator('.episode__status--ok').count()) >= 1, 'после перезапуска эпизод 1 отмечен «Прочитан»')
    } else {
      expect((await page.locator('.continue-card').count()) === 1, 'после перезапуска карточка «Продолжить» на месте')
      await page.waitForTimeout(250)
      await page.locator('.continue-card').click()
      s = await waitFor((x) => ['text', 'push', 'choice'].includes(x.screen), 'возврат в эпизод')
      expect(s.screen === lastScreen && s.text === lastText, '«Продолжить» возвращает на тот же экран')
    }
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
    const file = `${id}-crash.png`
    await page.screenshot({ path: join(OUT, file) }).catch(() => {})
    res.shots.push({ name: 'crash', file })
  }

  res.screensSeen = seen.size
  await context.close()
  return res
}

// ---------------------------------------------------------------------------
// Бюджет сборки
// ---------------------------------------------------------------------------

function bundleSize() {
  let bytes = 0
  for (const f of readdirSync(DIST_ASSETS)) {
    if (/\.(js|css)$/.test(f)) bytes += gzipSync(readFileSync(join(DIST_ASSETS, f))).length
  }
  return Math.round((bytes / 1024) * 10) / 10
}

// ---------------------------------------------------------------------------
// Запуск браузера
// ---------------------------------------------------------------------------

async function launchBrowser() {
  const attempts = []
  if (process.env.CHROME_PATH) attempts.push({ executablePath: process.env.CHROME_PATH })
  attempts.push({}, { channel: 'chrome' }, { channel: 'msedge' })
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts })
    } catch {
      // пробуем следующий вариант
    }
  }
  throw new Error(
    'Не найден браузер. Установи Google Chrome или Microsoft Edge, либо укажи путь в переменной CHROME_PATH, ' +
      'либо скачай Chromium: npx playwright-core install chromium',
  )
}

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function writeReport(results, global, startedAt) {
  const total = results.reduce((n, r) => n + r.errors.length, 0) + global.errors.length
  const cases = results
    .map(
      (r) => `
    <section class="case ${r.errors.length ? 'bad' : 'good'}">
      <h2>${r.errors.length ? '✗' : '✓'} ${r.vp.width}×${r.vp.height} · ${MODE_LABEL[r.mode]}${r.full ? ' · весь эпизод' : ''}</h2>
      <p class="meta">проверок пройдено: ${r.passed.length} · ошибок: ${r.errors.length} · замечаний: ${r.warnings.length} · экранов пройдено: ${r.screensSeen}</p>
      ${r.errors.length ? `<ul class="errors">${r.errors.map((e) => `<li>✗ ${esc(e)}</li>`).join('')}</ul>` : ''}
      ${r.warnings.length ? `<ul class="warnings">${r.warnings.map((w) => `<li>! ${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="shots">${r.shots.map((s) => `<figure><img src="${s.file}" loading="lazy" alt=""><figcaption>${esc(s.name)}</figcaption></figure>`).join('')}</div>
      <details><summary>Пройденные проверки</summary><ul>${r.passed.map((p) => `<li>✓ ${esc(p)}</li>`).join('')}</ul></details>
    </section>`,
    )
    .join('')

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Проверка интерфейса — ${total ? 'есть ошибки' : 'всё зелёное'}</title>
<style>
  body { margin: 0; padding: 24px 16px 48px; background: #14121a; color: #ece6dc; font: 15px/1.5 -apple-system, 'Segoe UI', Roboto, sans-serif; }
  main { max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 0 0 4px; }
  .meta { color: #b8b0c2; font-size: 13px; margin: 0 0 12px; }
  .case { border: 1px solid rgba(236,230,220,.12); border-radius: 14px; padding: 16px; margin-top: 16px; }
  .case.bad { border-color: #e78a7f; } .case.good h2 { color: #8fbf8f; } .case.bad h2 { color: #e78a7f; }
  ul { margin: 8px 0; padding-left: 18px; } .errors { color: #e78a7f; } .warnings { color: #c9a86a; }
  .shots { display: flex; gap: 12px; overflow-x: auto; padding: 8px 0; }
  figure { margin: 0; flex: none; } figcaption { font-size: 12px; color: #8a8395; text-align: center; }
  img { display: block; height: 360px; width: auto; border-radius: 8px; border: 1px solid rgba(236,230,220,.12); }
  details { margin-top: 8px; color: #b8b0c2; font-size: 13px; }
</style></head>
<body><main>
  <h1>${total ? `✗ Ошибок: ${total}` : '✓ Всё зелёное'}</h1>
  <p class="meta">${esc(startedAt)} · бюджет сборки: ${global.bundleKb} КБ gzip из ${BUDGET_KB}</p>
  ${global.errors.length ? `<ul class="errors">${global.errors.map((e) => `<li>✗ ${esc(e)}</li>`).join('')}</ul>` : ''}
  ${cases}
</main></body></html>`
  writeFileSync(join(OUT, 'report.html'), html)
}

// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toLocaleString('ru-RU')
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })

  const global = { errors: [], bundleKb: bundleSize() }
  if (global.bundleKb > BUDGET_KB) global.errors.push(`бюджет сборки превышен: ${global.bundleKb} КБ gzip > ${BUDGET_KB}`)

  // /api отвечает заглушка: события копятся здесь, прокси на локальный сервер не нужен.
  // Так проверяется настоящий путь отправки, включая sendBeacon при сворачивании.
  const apiLog = []
  const apiStub = {
    name: 'check-ui-api-stub',
    configurePreviewServer(srv) {
      srv.middlewares.use('/api', (req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          if (req.method === 'POST' && body) {
            try {
              apiLog.push(JSON.parse(body))
            } catch {
              apiLog.push({ invalid: true })
            }
          }
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
  const server = await preview({
    logLevel: 'error',
    plugins: [apiStub],
    preview: { host: '127.0.0.1', port: 4173, strictPort: false, open: false },
  })
  const baseUrl = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:4173/'
  const browser = await launchBrowser()

  const results = []
  try {
    for (const vp of VIEWPORTS) {
      for (const mode of MODES) {
        if (ONLY && !ONLY.includes(`${vp.id}-${mode}`)) continue
        const r = await runCase(browser, baseUrl, apiLog, vp, mode)
        results.push(r)
        const mark = r.errors.length ? '✗' : '✓'
        console.log(`${mark} ${`${vp.width}×${vp.height}`.padEnd(9)} ${MODE_LABEL[mode].padEnd(8)} проверок: ${r.passed.length}, замечаний: ${r.warnings.length}`)
        for (const e of r.errors) console.log(`    ✗ ${e}`)
      }
    }
  } finally {
    await browser.close()
    await server.close()
  }

  writeReport(results, global, startedAt)

  const warnings = [...new Set(results.flatMap((r) => r.warnings))]
  if (warnings.length) {
    console.log(`\nЗамечания (не ломают проверку):`)
    for (const w of warnings) console.log(`  ! ${w}`)
  }
  for (const e of global.errors) console.log(`✗ ${e}`)

  const failed = results.some((r) => r.errors.length) || global.errors.length > 0
  console.log(`\nБюджет сборки: ${global.bundleKb} КБ gzip из ${BUDGET_KB}`)
  console.log(`Отчёт со скриншотами: ${join(OUT, 'report.html')}`)
  console.log(failed ? '\n✗ ПРОВЕРКА НЕ ПРОЙДЕНА' : '\n✓ ПРОВЕРКА ПРОЙДЕНА')
  process.exit(failed ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
