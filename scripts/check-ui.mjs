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

import { createServer, preview } from 'vite'
import { chromium } from 'playwright-core'
import { gzipSync } from 'node:zlib'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

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
/** Шкала слоёв из src/style.css (--z-*): что должно получиться на экране */
const Z_EXPECTED = { '.speaker': '1', '.topbar': '2', '.hud': '3', '.layer': '50', '.toast': '60' }
/** Эпизод целиком проходим на основном размере; на остальных — до первого выбора и чуть дальше */
const FULL_RUN = '390'

/** Быстрый прогон части сценариев: CHECK_ONLY=390-telegram,320-browser */
const ONLY = process.env.CHECK_ONLY ? process.env.CHECK_ONLY.split(',').map((s) => s.trim()) : null
const selected = (id) => !ONLY || ONLY.some((o) => id === o || id.startsWith(`${o}-`))

const MODE_LABEL = { browser: 'браузер', telegram: 'Telegram' }
/** Правило имени события на сервере (server/index.mjs, cleanEvent): иначе событие выбрасывается молча */
const SERVER_EVENT_NAME = /^[a-z_]{1,40}$/

/** Списки из каталога src/tracking.ts: EVENT_NAMES и UI_TARGETS */
function readCatalog(name) {
  const code = readFileSync(resolve('src/tracking.ts'), 'utf8')
  const block = code.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))
  if (!block) return []
  return [...block[1].replace(/\/\/.*$/gm, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
}
const EVENT_NAMES = readCatalog('EVENT_NAMES')
const UI_TARGETS = readCatalog('UI_TARGETS')
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

function auditLayout({ minTap, safeBottom, zSelectors }) {
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

  // У каждой видимой кнопки есть цель аналитики (data-track ставит button() с параметром tap)
  const untracked = []
  for (const el of document.querySelectorAll('button:not([disabled]), [role="button"]')) {
    if (!visible(el) || el.closest('[aria-hidden="true"]')) continue
    if (!el.dataset.track) untracked.push(label(el))
  }

  // Под home bar не должно уходить ничего из экрана чтения (прокручиваемые экраны — не в счёт)
  const underHomeBar = []
  if (safeBottom > 0) {
    for (const el of document.querySelectorAll('.stage button, .stage .dialog, .stage .choices, .stage .push')) {
      if (!visible(el)) continue
      if (el.getBoundingClientRect().bottom > vh - safeBottom + 1) underHomeBar.push(label(el))
    }
  }

  // Слои: токены --z-* должны разрешаться в числа (опечатка в имени токена = z-index: auto)
  const zIndex = {}
  for (const sel of zSelectors) {
    const el = document.querySelector(sel)
    if (el) zIndex[sel] = getComputedStyle(el).zIndex
  }

  // Каркас: экраны и слои внутри кадра; чтение — без хедера и таббара; пустые зоны скрыты
  let shell = null
  const shellEl = document.querySelector('.app-shell')
  if (shellEl) {
    const f = shellEl.getBoundingClientRect()
    const outside = []
    for (const el of document.querySelectorAll('.layer, .toast, .screen, .stage, .loading, .error')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) outside.push(label(el))
    }
    const shown = (sel) => getComputedStyle(shellEl.querySelector(sel)).display !== 'none'
    const filled = (...slots) => slots.some((sl) => shellEl.querySelector(`[data-slot="${sl}"]`)?.hasChildNodes())
    shell = {
      outside: [...new Set(outside)],
      chrome: shellEl.dataset.chrome,
      reading: !!document.querySelector('.stage'),
      headerShown: shown('.app-header'),
      tabbarShown: shown('.app-tabbar'),
      headerFilled: filled('header', 'account'),
      tabbarFilled: filled('tabbar'),
    }
  }

  // Подстановка t() не сработала: на экране осталось {имя}
  const placeholders = [...new Set(document.body.innerText.match(/\{[A-Za-z_]+\}/g) ?? [])]

  return {
    shell,
    untracked: [...new Set(untracked)],
    placeholders,
    zIndex,
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

/** Новый прогон: результат, контекст браузера с имитацией Telegram, страница со слежением за ошибками */
async function openCase(browser, vp, mode, { id, label = '', full = false, allowFailed = [] }) {
  const res = { id, label, vp, mode, full, errors: [], warnings: [], passed: [], shots: [], screensSeen: 0 }
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
    // Метка прогона: заглушка /api раскладывает по ней пачки аналитики — запоздавший sendBeacon
    // прошлого прогона не попадёт в этот
    extraHTTPHeaders: { 'x-check-case': id },
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.mobile ? 2 : 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
    locale: 'ru-RU',
  })

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
    if (allowFailed.some((part) => r.url().includes(part))) return
    fail(`запрос не прошёл: ${r.url()} (${r.failure()?.errorText})`)
  })
  page.on('response', (r) => {
    if (r.status() >= 400) warn(`файл не найден (${r.status()}): ${new URL(r.url()).pathname}`)
  })

  return { res, context, page, safeBottom, fail, warn, expect }
}

/** Ждать экран игры (меню, история, чтение…) */
async function waitForScreen(page, pred, what, timeout = 8000) {
  const start = Date.now()
  let s = null
  while (Date.now() - start < timeout) {
    s = await page.evaluate(readScreen)
    if (pred(s)) return s
    await page.waitForTimeout(100)
  }
  throw new Error(`не дождались: ${what} (на экране: ${s?.screen})`)
}

/** Состояние приложения (store) — доступно при открытии с ?debug */
const readAppState = (page) => page.evaluate(() => window.__game?.state() ?? null)

/** Ждать, пока состояние приложения не станет нужным */
async function waitForAppState(page, pred, what, timeout = 6000) {
  const start = Date.now()
  let st = null
  while (Date.now() - start < timeout) {
    st = await readAppState(page)
    if (st && pred(st)) return st
    await page.waitForTimeout(100)
  }
  throw new Error(`не дождались состояния: ${what}`)
}

async function runCase(browser, baseUrl, apiLog, vp, mode) {
  const id = `${vp.id}-${mode}`
  const full = vp.id === FULL_RUN
  const { res, context, page, safeBottom, fail, warn, expect } = await openCase(browser, vp, mode, { id, full })

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
  /** Досылаем очередь аналитики и ищем нажатие с нужной целью и историей */
  const expectTap = async (target) => {
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.waitForTimeout(400)
    const tap = apiLog
      .filter((p) => p.caseId === id)
      .flatMap((p) => p.events ?? [])
      .find((e) => e.event === 'ui_tap' && e.data?.target === target)
    expect(!!tap && typeof tap.data.value === 'string' && tap.data.value.length > 0, `аналитика: нажатие ${target} с историей в value`)
  }

  const audit = async (name) => {
    const m = await page.evaluate(auditLayout, { minTap: MIN_TAP, safeBottom, zSelectors: Object.keys(Z_EXPECTED) })
    expect(!m.hScroll, `${name}: нет горизонтальной прокрутки`)
    expect(!m.vScroll, `${name}: документ зафиксирован, прокручивается только контент`)
    expect(m.cutOff.length === 0, `${name}: кнопки и блоки текста не обрезаны краем экрана${m.cutOff.length ? ` — ${m.cutOff.join(', ')}` : ''}`)
    if (m.smallTargets.length) warn(`${name}: зона касания меньше ${MIN_TAP} px — ${m.smallTargets.join('; ')}`)
    if (m.underHomeBar.length) warn(`${name}: уходит под home bar (${SAFE_BOTTOM} px) — ${m.underHomeBar.join(', ')}`)
    expect(!!m.shell, `${name}: экран внутри каркаса`)
    if (m.shell) {
      const sh = m.shell
      expect(sh.outside.length === 0, `${name}: экраны и слои внутри кадра${sh.outside.length ? ` — за кадром: ${sh.outside.join(', ')}` : ''}`)
      expect(sh.chrome === (sh.reading ? 'immersive' : 'full'), `${name}: каркас — ${sh.reading ? 'чтение без хедера и таббара' : 'обычный режим'} (сейчас ${sh.chrome})`)
      expect(
        sh.headerShown === (sh.headerFilled && sh.chrome === 'full') && sh.tabbarShown === (sh.tabbarFilled && sh.chrome === 'full'),
        `${name}: хедер и таббар видны, только когда в них есть содержимое и это не чтение`,
      )
    }
    expect(m.untracked.length === 0, `${name}: у каждой кнопки есть цель аналитики${m.untracked.length ? ` — нет у ${m.untracked.join(', ')}` : ''}`)
    expect(m.placeholders.length === 0, `${name}: в текстах нет незаполненных подстановок${m.placeholders.length ? ` — ${m.placeholders.join(', ')}` : ''}`)
    for (const [sel, z] of Object.entries(m.zIndex)) expect(z === Z_EXPECTED[sel], `${name}: слой ${sel} = ${Z_EXPECTED[sel]} (токен z-index разрешился, сейчас ${z})`)
    const file = `${id}-${name}.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name, file })
  }

  try {
    // 1. Первый запуск → сразу эпизод (гипотеза H3)
    await page.goto(`${baseUrl}?debug`)
    let s = await waitFor((x) => !['unknown', 'loading'].includes(x.screen), 'первый экран')
    expect(['text', 'push', 'choice'].includes(s.screen), 'первый запуск открывает эпизод, а не меню')

    // Состояние приложения: платформа, маршрут, конфиг; экономика выключена — баланс не запрашивается
    let app = await waitForAppState(page, (x) => x.config.status === 'ready', 'конфиг загружен с сервера')
    expect(app.platform.kind === mode, `состояние: платформа — ${mode}`)
    expect(app.platform.isDesktop === !vp.mobile, `состояние: ${vp.mobile ? 'мобильное' : 'десктопное'} устройство определено верно`)
    expect(app.ui.route.name === 'reading', 'состояние: маршрут — чтение')
    expect(!app.config.economy_enabled && !app.config.store_enabled && !app.config.inbox_enabled, 'конфиг: экономика, магазин и входящие выключены')
    expect(app.wallet.status === 'idle' && app.wallet.nishtyak === null, 'экономика выключена — баланс не запрашивается')
    expect(app.inbox.status === 'idle', 'входящие выключены — не запрашиваются')
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
    if (mode === 'browser') expect(await page.evaluate(() => history.state?.gameBack === true), 'браузер: системная «Назад» перехвачена — запись в истории')

    // 5. «Назад»: эпизод → история → меню.
    // Браузер: эпизод → история — системной «Назад» (жест Android, кнопка браузера), история → меню — кнопкой на экране.
    // Telegram: оба раза — системная BackButton.
    if (mode === 'browser') await page.evaluate(() => history.back())
    else await back()
    await waitFor((x) => x.screen === 'story', 'экран истории')
    await page.waitForTimeout(250)
    await audit('story')
    app = await readAppState(page)
    expect(app.ui.route.name === 'story' && typeof app.ui.route.storyId === 'string', 'состояние: маршрут — история')
    if (mode === 'browser') await page.locator('.btn-back').click()
    else await back()
    s = await waitFor((x) => x.screen === 'menu', 'главное меню')
    await page.waitForTimeout(250)
    await audit('menu')
    app = await readAppState(page)
    expect(app.ui.route.name === 'menu', 'состояние: маршрут — меню')
    if (mode === 'telegram') expect(!(await page.evaluate(() => window.__check.backVisible())), 'Telegram: на главном меню «Назад» скрыта')
    if (mode === 'browser') {
      await page.waitForTimeout(300)
      expect(!(await page.evaluate(() => history.state?.gameBack)), 'браузер: у главного меню лишней записи «Назад» в истории нет')
    }
    // «Продолжить» — только если есть недочитанный эпизод (src/ui/menu.ts)
    const continueCards = await page.locator('.continue-card').count()
    if (full) expect(continueCards === 0, 'эпизод дочитан — карточки «Продолжить» нет')
    else expect(continueCards === 1, 'в меню есть карточка «Продолжить»')
    expect((await page.locator('.folder').count()) >= 1, 'в меню есть каталог историй')

    // 6. Аналитика: сворачивание досылает пачку
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.waitForTimeout(400)
    const payloads = apiLog.filter((p) => p.caseId === id)
    expect(payloads.every((p) => !p.invalid), 'аналитика: пачки событий — валидный JSON')
    const events = payloads.flatMap((p) => p.events ?? [])
    const names = new Set(events.map((e) => e.event))
    for (const need of REQUIRED_EVENTS) expect(names.has(need), `аналитика: ${need}`)
    const badNames = [...names].filter((n) => !SERVER_EVENT_NAME.test(n) || !EVENT_NAMES.includes(n))
    expect(badNames.length === 0, `аналитика: все имена событий из каталога и проходят фильтр сервера${badNames.length ? ` — нет: ${badNames.join(', ')}` : ''}`)
    const taps = events.filter((e) => e.event === 'ui_tap')
    const tapTargets = new Set(taps.map((e) => e.data?.target))
    expect(tapTargets.has('reading.pause'), 'аналитика: нажатие на меню паузы (ui_tap reading.pause)')
    expect(!tapTargets.has('reading.choice'), 'аналитика: выбор пишется только choice_made, без дубля ui_tap')
    if (mode === 'browser') expect(tapTargets.has('story.back'), 'аналитика: нажатие кнопки «Назад» на экране истории (story.back)')
    const unknownTargets = [...tapTargets].filter((x) => !UI_TARGETS.includes(x))
    expect(unknownTargets.length === 0, `аналитика: цели нажатий только из каталога${unknownTargets.length ? ` — чужие: ${unknownTargets.join(', ')}` : ''}`)
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
      await expectTap('menu.folder')
    } else {
      expect((await page.locator('.continue-card').count()) === 1, 'после перезапуска карточка «Продолжить» на месте')
      await page.waitForTimeout(250)
      await page.locator('.continue-card').click()
      s = await waitFor((x) => ['text', 'push', 'choice'].includes(x.screen), 'возврат в эпизод')
      expect(s.screen === lastScreen && s.text === lastText, '«Продолжить» возвращает на тот же экран')
      await expectTap('menu.continue')
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
// Дополнительные сценарии: состояние и конфиг в крайних случаях
// ---------------------------------------------------------------------------

/** Флаги включены параметром ?ff= → баланс и входящие загружаются из API (пока моки) в состояние */
async function runFlagsOn(browser, baseUrl) {
  const vp = VIEWPORTS.find((v) => v.id === '390')
  const { res, context, page, expect, fail } = await openCase(browser, vp, 'browser', { id: '390-browser-flags', label: 'флаги включены через ?ff=' })
  try {
    await page.goto(`${baseUrl}?debug&ff=economy_enabled,inbox_enabled`)
    const app = await waitForAppState(page, (x) => x.wallet.status === 'ready' && x.inbox.status === 'ready', 'баланс и входящие загружены')
    expect(app.config.economy_enabled && app.config.inbox_enabled && !app.config.store_enabled, 'включились ровно флаги из ?ff=')
    expect(app.config.overrides.join(',') === 'economy_enabled,inbox_enabled', 'включённые через ?ff= флаги видны в состоянии')
    expect(Number.isFinite(app.wallet.nishtyak) && Number.isFinite(app.wallet.generic) && app.wallet.syncedAt > 0, 'баланс: оба числа и время пришли из API')
    expect(app.inbox.items.length > 0 && app.inbox.unread > 0 && app.inbox.unread <= app.inbox.items.length, 'входящие: список и счётчик непрочитанных')
    const s = await waitForScreen(page, (x) => !['unknown', 'loading'].includes(x.screen), 'первый экран')
    expect(['text', 'push', 'choice'].includes(s.screen), 'с включёнными флагами игра стартует как обычно')
    const file = `${res.id}-reading.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name: 'reading', file })
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
  }
  await context.close()
  return res
}

/** Конфиг недоступен (сеть, сбой сервера) → игра стартует на значениях по умолчанию */
async function runConfigOffline(browser, baseUrl) {
  const vp = VIEWPORTS.find((v) => v.id === '390')
  const { res, context, page, expect, fail } = await openCase(browser, vp, 'telegram', {
    id: '390-telegram-config-offline',
    label: 'конфиг недоступен',
    allowFailed: ['/config.json'],
  })
  try {
    await page.route('**/config.json', (route) => route.abort('failed'))
    await page.goto(`${baseUrl}?debug`)
    const app = await waitForAppState(page, (x) => x.config.status === 'error', 'отказ загрузки конфига обработан')
    expect(!app.config.economy_enabled && !app.config.store_enabled && !app.config.inbox_enabled, 'без конфига всё новое выключено (значения по умолчанию)')
    const s = await waitForScreen(page, (x) => !['unknown', 'loading'].includes(x.screen), 'первый экран')
    expect(['text', 'push', 'choice'].includes(s.screen), 'без конфига игра открывает эпизод как обычно')
    const file = `${res.id}-reading.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name: 'reading', file })
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
  }
  await context.close()
  return res
}

// ---------------------------------------------------------------------------
// Строки интерфейса мимо t(): кириллица в строковых литералах src/
// Исключения: словари (src/locales), мок-данные сервера (src/api.mock.ts), console.* и new Error(...)
// ---------------------------------------------------------------------------

const SRC = resolve('src')
// layout/preview.ts — стенд каркаса (layout.html), в сборку игры не входит
const I18N_EXEMPT = [/^locales[\\/]/, /^api\.mock\.ts$/, /^layout[\\/]preview\.ts$/]

function listTs(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? listTs(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : [],
  )
}

/** Строковые литералы файла с номерами строк — без комментариев, с учётом шаблонов `...${}...` */
function stringLiterals(code) {
  const out = []
  const templateDepths = [] // глубина {} кода, на которой открылся ${ — по ней понятно, где шаблон продолжается
  let depth = 0
  let line = 1
  let i = 0
  const readTemplate = () => {
    const start = line
    let text = ''
    while (i < code.length) {
      const c = code[i]
      if (c === '\\') {
        text += code[i + 1]
        i += 2
        continue
      }
      if (c === '`') {
        i++
        break
      }
      if (c === '$' && code[i + 1] === '{') {
        templateDepths.push(depth)
        i += 2
        break
      }
      if (c === '\n') line++
      text += c
      i++
    }
    out.push({ text, line: start })
  }
  while (i < code.length) {
    const c = code[i]
    const d = code[i + 1]
    if (c === '\n') {
      line++
      i++
    } else if (c === '/' && d === '/') {
      while (i < code.length && code[i] !== '\n') i++
    } else if (c === '/' && d === '*') {
      i += 2
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) {
        if (code[i] === '\n') line++
        i++
      }
      i += 2
    } else if (c === "'" || c === '"') {
      const start = line
      let text = ''
      i++
      while (i < code.length && code[i] !== c && code[i] !== '\n') {
        if (code[i] === '\\') {
          text += code[i + 1]
          i += 2
          continue
        }
        text += code[i]
        i++
      }
      i++
      out.push({ text, line: start })
    } else if (c === '`') {
      i++
      readTemplate()
    } else if (c === '}' && templateDepths.length && templateDepths[templateDepths.length - 1] === depth) {
      templateDepths.pop()
      i++
      readTemplate()
    } else {
      if (c === '{') depth++
      if (c === '}') depth--
      i++
    }
  }
  return out
}

function hardcodedUiStrings() {
  const found = []
  for (const file of listTs(SRC)) {
    const rel = relative(SRC, file)
    if (I18N_EXEMPT.some((re) => re.test(rel))) continue
    const code = readFileSync(file, 'utf8')
    const lines = code.split('\n')
    for (const lit of stringLiterals(code)) {
      if (!/[А-Яа-яЁё]/.test(lit.text)) continue
      if (/console\.|new Error\(/.test(lines[lit.line - 1])) continue
      found.push(`src/${rel.replace(/\\/g, '/')}:${lit.line} «${lit.text.trim().slice(0, 40)}»`)
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// Регресс: то, что основной проход не трогает — клавиатура, рестарт с подтверждением, перечитывание,
// тост, всё внутри кадра. Десктоп-браузер (кадр «телефон») и маленький телефон в Telegram.
// ---------------------------------------------------------------------------

async function runRegression(browser, baseUrl, apiLog, vpId, mode) {
  const vp = VIEWPORTS.find((v) => v.id === vpId)
  const id = `${vpId}-${mode}-regress`
  const { res, context, page, expect, fail } = await openCase(browser, vp, mode, { id, label: 'регресс: клавиатура, диалоги, тост' })
  const state = () => page.evaluate(readScreen)
  const shot = async (name) => {
    const file = `${id}-${name}.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name, file })
  }
  const layersInFrame = () =>
    page.evaluate(() => {
      const f = document.querySelector('.app-shell').getBoundingClientRect()
      const layers = [...document.querySelectorAll('.layer, .toast')]
      return (
        layers.length > 0 &&
        layers.every((l) => {
          const r = l.getBoundingClientRect()
          return r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1
        })
      )
    })
  const press = async (key) => {
    await page.keyboard.press(key)
    await page.waitForTimeout(TAP_GUARD_MS + 80)
  }
  try {
    await page.goto(`${baseUrl}?debug`)
    let s = await waitForScreen(page, (x) => ['text', 'push', 'choice'].includes(x.screen), 'первый экран')
    const firstText = s.text
    await page.waitForTimeout(TAP_GUARD_MS + 100)

    // 1. Клавиатура (Telegram Desktop, браузер): Enter листает, цифра выбирает
    for (let i = 0; i < 80 && s.screen !== 'choice'; i++) {
      await press('Enter')
      s = await state()
    }
    expect(s.screen === 'choice', 'клавиатура: Enter листает до выбора')
    const beforeKey = s.text
    await press('1')
    await page.waitForTimeout(250)
    s = await state()
    expect(s.text !== beforeKey, 'клавиатура: цифра 1 выбирает первый вариант')

    // 2. Пауза → «Начать эпизод сначала» → диалог поверх шторки → подтвердить
    await page.locator('.hud button').first().click()
    await page.locator('[data-track="pause.restart"]').click()
    await page.locator('.layer--dialog').waitFor()
    await page.waitForTimeout(250)
    expect((await page.locator('.layer').count()) === 2, 'пауза: диалог «Начать сначала?» поверх шторки')
    expect(await layersInFrame(), 'шторка и диалог внутри кадра')
    await shot('restart-dialog')
    await page.locator('.layer--dialog .btn--danger').click()
    s = await waitForScreen(page, (x) => !x.overlay && x.text === firstText, 'эпизод с начала').catch(() => null)
    expect(!!s, 'рестарт возвращает на первый экран эпизода, слои закрыты')
    s = await state()
    await page.waitForTimeout(TAP_GUARD_MS)

    // 3. До конца эпизода с клавиатуры
    for (let i = 0; i < 200 && s.screen !== 'end'; i++) {
      await press(s.screen === 'choice' ? '1' : 'Enter')
      s = await state()
    }
    expect(s.screen === 'end', 'клавиатура: эпизод проходится до карточки конца')

    // 4. Карточка конца → «К истории» → прочитанный эпизод → «Перечитать?» → «Отмена»
    await page.locator('[data-track="end.toStory"]').first().click()
    await waitForScreen(page, (x) => x.screen === 'story', 'экран истории')
    await page.waitForTimeout(250)
    await page.locator('[data-track="story.episodeReread"]').first().click()
    await page.locator('.layer--dialog').waitFor()
    await page.waitForTimeout(250)
    expect(await layersInFrame(), 'диалог «Перечитать?» внутри кадра')
    await shot('reread-dialog')
    await page.locator('.layer--dialog .btn--secondary').click()
    s = await waitForScreen(page, (x) => x.screen === 'story' && !x.overlay, 'отмена диалога').catch(() => null)
    expect(!!s, '«Отмена» закрывает диалог и оставляет на экране истории')

    // 5. Меню → папка «В разработке» → тост внутри кадра
    if (mode === 'telegram') await page.evaluate(() => window.__check.pressBack())
    else await page.locator('.btn-back').click()
    await waitForScreen(page, (x) => x.screen === 'menu', 'главное меню')
    await page.waitForTimeout(250)
    await page.locator('[data-track="menu.folderSoon"]').first().click()
    await page.locator('.toast').waitFor()
    await page.waitForTimeout(300)
    expect(await layersInFrame(), 'тост внутри кадра')
    await shot('toast')

    // 6. Аналитика всего пути
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
    await page.waitForTimeout(400)
    const events = apiLog.filter((p) => p.caseId === id).flatMap((p) => p.events ?? [])
    const taps = events.filter((e) => e.event === 'ui_tap').map((e) => `${e.data?.target}${e.data?.value !== undefined ? `:${e.data.value}` : ''}`)
    for (const need of ['pause.restart', 'dialog.restart:confirm', 'end.toStory', 'story.episodeReread:1', 'dialog.reread:cancel']) {
      expect(taps.includes(need), `аналитика: ${need}`)
    }
    expect(taps.some((x) => x.startsWith('menu.folderSoon:')), 'аналитика: menu.folderSoon с историей')
    expect(events.some((e) => e.event === 'episode_complete'), 'аналитика: episode_complete после рестарта')
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
    await shot('crash').catch(() => {})
  }
  await context.close()
  return res
}

/** Старое сохранение v1 (одна глава) переносится в историю «Намертво» и ведёт на сохранённый экран */
async function runMigration(browser, baseUrl) {
  const vp = VIEWPORTS.find((v) => v.id === '390')
  const id = '390-browser-migrate'
  const { res, context, page, expect, fail } = await openCase(browser, vp, 'browser', { id, label: 'перенос сохранения v1' })
  const sceneId = 'e1_s04'
  const chapter = JSON.parse(readFileSync(resolve('public/content/ru/ch1.json'), 'utf8'))
  const expectedText = String(chapter.scenes?.[sceneId]?.text ?? '').trim()
  try {
    await page.addInitScript((save) => {
      if (sessionStorage.getItem('__check_migrated')) return
      localStorage.setItem('game_state', save)
      sessionStorage.setItem('__check_migrated', '1')
    }, JSON.stringify({ chapter: 1, sceneId, counters: {}, picks: [], run: 1, savedAt: Date.now() }))
    await page.goto(`${baseUrl}?debug`)
    await waitForScreen(page, (x) => !['unknown', 'loading'].includes(x.screen), 'первый экран')
    let s = await page.evaluate(readScreen)
    expect(s.screen === 'menu', 'сохранение v1: игра открывает меню, а не первый запуск')
    expect((await page.locator('.continue-card').count()) === 1, 'сохранение v1: карточка «Продолжить» на месте')
    await page.waitForTimeout(250)
    await page.locator('.continue-card').click()
    s = await waitForScreen(page, (x) => ['text', 'push', 'choice'].includes(x.screen), 'возврат в эпизод')
    expect(!!expectedText && s.text === expectedText, 'сохранение v1: «Продолжить» ведёт на сохранённый экран')
    const v = await page.evaluate(() => JSON.parse(localStorage.getItem('game_state') ?? '{}').v)
    expect(v === 2, 'сохранение переписано в формат v2')
    const file = `${id}.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name: 'перенос v1', file })
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
  }
  await context.close()
  return res
}

// ---------------------------------------------------------------------------
// Стенд каркаса (layout.html): кадр «телефон в центре» и зоны внутри него
// ---------------------------------------------------------------------------

const FRAME_W = 440 // ширина кадра от 600 px окна (src/layout/shell.css)
const FRAME_MAX_H = 932

/**
 * frame: full — кадр на весь экран (телефон); column — колонка по центру (планшет, телефон боком,
 * низкое окно); phone — «телефон» со скруглениями и полями (десктоп с мышью, окно от 600×700).
 * bp — брейкпоинт кадра из @container: xs < 360, sm, low — высота кадра ≤ 500.
 */
const STAND_CASES = [
  { id: 'shell-320', label: 'каркас', width: 320, height: 568, mobile: true, frame: 'full', bp: 'xs' },
  { id: 'shell-390', label: 'каркас', width: 390, height: 844, mobile: true, frame: 'full', bp: 'sm' },
  { id: 'shell-390-tg', label: 'каркас · Telegram fullscreen', width: 390, height: 844, mobile: true, tg: true, frame: 'full', bp: 'sm', insets: { top: 47, contentTop: 46 } },
  { id: 'shell-390-immersive', label: 'каркас · режим чтения', width: 390, height: 844, mobile: true, query: '?immersive', frame: 'full', bp: 'sm', immersive: true },
  { id: 'shell-844x390', label: 'каркас · телефон боком', width: 844, height: 390, mobile: true, frame: 'column', bp: 'low' },
  { id: 'shell-768', label: 'каркас · планшет', width: 768, height: 1024, mobile: true, frame: 'column', bp: 'sm' },
  { id: 'shell-1280x650', label: 'каркас · низкое окно десктопа', width: 1280, height: 650, mobile: false, frame: 'column', bp: 'sm' },
  { id: 'shell-1440', label: 'каркас · десктоп', width: 1440, height: 900, mobile: false, frame: 'phone', bp: 'sm' },
]

function measureStand() {
  const q = (s) => document.querySelector(s)
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }
  }
  const shell = q('.app-shell')
  const content = q('.app-content')
  const header = q('.app-header')
  const tabbar = q('.app-tabbar')
  const shown = (el) => getComputedStyle(el).display !== 'none'
  const before = JSON.stringify([r(header), r(tabbar)])
  content.scrollTop = 300
  const scrolled = content.scrollTop
  const chromeStable = JSON.stringify([r(header), r(tabbar)]) === before
  content.scrollTop = 0
  const doc = document.scrollingElement
  return {
    vw: innerWidth,
    vh: innerHeight,
    frame: r(shell),
    radius: parseFloat(getComputedStyle(shell).borderTopLeftRadius) || 0,
    backdrop: shown(q('.app-backdrop')),
    header: r(header),
    tabbar: r(tabbar),
    headerShown: shown(header),
    tabbarShown: shown(tabbar),
    content: r(content),
    probe: r(q('.shell-probe')),
    accountWidth: q('.app-header__account').getBoundingClientRect().width,
    bp: getComputedStyle(content).getPropertyValue('--shell-bp').trim().replace(/^['"]|['"]$/g, ''),
    scrolled,
    chromeStable,
    docLocked: doc.scrollHeight <= innerHeight + 1,
    hScroll: doc.scrollWidth > innerWidth + 1,
  }
}

async function runStandCase(browser, standUrl, c) {
  const vp = { id: c.id, width: c.width, height: c.height, mobile: c.mobile }
  const { res, context, page, expect, fail } = await openCase(browser, vp, c.tg ? 'telegram' : 'browser', { id: c.id, label: c.label })
  const near = (a, b) => Math.abs(a - b) <= 1
  try {
    await page.goto(`${standUrl}${c.query ?? ''}`)
    await page.waitForSelector('.app-shell')
    if (c.insets) {
      await page.evaluate((ins) => {
        const s = document.documentElement.style
        s.setProperty('--tg-safe-area-inset-top', `${ins.top}px`)
        s.setProperty('--tg-content-safe-area-inset-top', `${ins.contentTop}px`)
        window.dispatchEvent(new Event('resize'))
      }, c.insets)
    }
    await page.waitForTimeout(300)
    const m = await page.evaluate(measureStand)
    const f = m.frame

    // Кадр: размер решает окно
    if (c.frame === 'full') {
      expect(near(f.left, 0) && near(f.top, 0) && near(f.width, m.vw) && near(f.height, m.vh), 'кадр на весь экран (телефон)')
      expect(m.radius === 0 && !m.backdrop, 'без скруглений и фона вокруг')
    } else {
      expect(near(f.width, FRAME_W) && near(f.left, (m.vw - FRAME_W) / 2), `кадр — колонка ${FRAME_W} px по центру`)
      expect(m.backdrop, 'вокруг кадра — фон')
    }
    if (c.frame === 'column') expect(near(f.top, 0) && near(f.height, m.vh) && m.radius === 0, 'колонка на всю высоту, без скруглений')
    if (c.frame === 'phone') {
      expect(near(f.height, Math.min(FRAME_MAX_H, m.vh - 48)) && near(f.top, (m.vh - f.height) / 2), 'десктоп: «телефон» с полями сверху и снизу')
      expect(m.radius > 0, 'десктоп: скруглённые углы')
    }

    // Зоны внутри кадра
    expect(m.bp === c.bp, `брейкпоинт кадра (@container) — ${c.bp}, сейчас ${m.bp || 'нет'}`)
    if (c.immersive) {
      expect(!m.headerShown && !m.tabbarShown, 'режим чтения: хедер и таббар скрыты')
      expect(near(m.content.top, f.top) && near(m.content.bottom, f.bottom), 'режим чтения: контент на весь кадр')
    } else {
      expect(near(m.header.top, f.top) && near(m.tabbar.bottom, f.bottom), 'хедер прижат к верху кадра, таббар — к низу')
      expect(near(m.content.top, m.header.bottom) && near(m.content.bottom, m.tabbar.top), 'контент занимает всё между хедером и таббаром')
      expect(m.chromeStable, 'при прокрутке контента хедер и таббар на месте')
    }
    expect(m.scrolled > 0, 'длинный контент прокручивается внутри зоны')
    expect(m.docLocked && !m.hScroll, 'документ зафиксирован, горизонтальной прокрутки нет')
    expect(near(m.probe.left, f.left) && near(m.probe.width, f.width) && near(m.probe.bottom, f.bottom), 'position: fixed внутри кадра не выходит за кадр (шторки, тосты)')
    expect(m.accountWidth === 0, 'пустой слот «Аккаунт» не занимает места')
    if (c.insets) {
      expect(near(m.header.height, c.insets.top + c.insets.contentTop + 56), 'Telegram fullscreen: хедер ниже «чёлки» и кнопок Telegram')
      expect(near(m.tabbar.height, 56 + SAFE_BOTTOM), 'Telegram fullscreen: таббар выше home bar')
    }

    const file = `${c.id}.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name: c.label, file })
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
  }
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
      <h2>${r.errors.length ? '✗' : '✓'} ${r.vp.width}×${r.vp.height} · ${MODE_LABEL[r.mode]}${r.full ? ' · весь эпизод' : ''}${r.label ? ` · ${esc(r.label)}` : ''}</h2>
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
  for (const hit of hardcodedUiStrings()) global.errors.push(`строка интерфейса мимо t(): ${hit}`)
  if (!EVENT_NAMES.length || !UI_TARGETS.length) global.errors.push('каталог событий src/tracking.ts не прочитан')
  for (const n of EVENT_NAMES.filter((x) => !SERVER_EVENT_NAME.test(x))) global.errors.push(`имя события «${n}» сервер отбросит: только a-z и _, до 40 символов`)
  const dupTargets = UI_TARGETS.filter((x, i) => UI_TARGETS.indexOf(x) !== i)
  if (dupTargets.length) global.errors.push(`цели нажатий повторяются: ${dupTargets.join(', ')}`)

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
            const caseId = String(req.headers['x-check-case'] ?? '')
            try {
              apiLog.push({ caseId, ...JSON.parse(body) })
            } catch {
              apiLog.push({ caseId, invalid: true })
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
  const logResult = (r) => {
    results.push(r)
    const mark = r.errors.length ? '✗' : '✓'
    const extra = r.label ? ` · ${r.label}` : ''
    console.log(`${mark} ${`${r.vp.width}×${r.vp.height}`.padEnd(9)} ${MODE_LABEL[r.mode].padEnd(8)} проверок: ${r.passed.length}, замечаний: ${r.warnings.length}${extra}`)
    for (const e of r.errors) console.log(`    ✗ ${e}`)
  }
  try {
    for (const vp of VIEWPORTS) {
      for (const mode of MODES) {
        if (!selected(`${vp.id}-${mode}`)) continue
        logResult(await runCase(browser, baseUrl, apiLog, vp, mode))
      }
    }
    for (const [id, run] of [
      ['390-browser-flags', runFlagsOn],
      ['390-telegram-config-offline', runConfigOffline],
      ['1440-browser-regress', (b, u) => runRegression(b, u, apiLog, '1440', 'browser')],
      ['320-telegram-regress', (b, u) => runRegression(b, u, apiLog, '320', 'telegram')],
      ['390-browser-migrate', runMigration],
    ]) {
      if (!selected(id)) continue
      logResult(await run(browser, baseUrl))
    }
    const standCases = STAND_CASES.filter((c) => selected(c.id))
    if (standCases.length) {
      // Стенд каркаса не входит в сборку — открываем его через dev-сервер Vite
      const stand = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5180, strictPort: false, hmr: false } })
      await stand.listen()
      const standUrl = `${stand.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5180/'}layout.html`
      try {
        for (const c of standCases) logResult(await runStandCase(browser, standUrl, c))
      } finally {
        await stand.close()
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
