/**
 * Автопроверка интерфейса — `npm run check:ui`
 *
 * Берёт прод-сборку (dist), поднимает её через vite preview и проходит игру в настоящем
 * Chromium: 3 размера экрана × 2 режима.
 *   браузер  — игра открыта не из Telegram (отладка, будущая веб-версия);
 *   telegram — имитация Telegram WebApp: подписанный initData, системная «Назад»,
 *              облачное хранилище, отступ под home bar.
 *
 * Плюс стенды через dev-сервер Vite: каркас (layout.html, CHECK_ONLY=shell) и компоненты (kit.html, CHECK_ONLY=kit).
 *
 * ✗ ошибка    — проверка красная (код выхода 1).
 * ! замечание — не ломает проверку, но попадает в отчёт: это кандидаты в отдельные задачи.
 *
 * Отчёт со скриншотами: .checks/ui/report.html
 * Браузер ищется так: CHROME_PATH → Chromium Playwright → Google Chrome → Microsoft Edge.
 */

import { createServer, preview } from 'vite'
import { checkStatsUi } from './check-stats-ui.mjs'
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
  for (const el of document.querySelectorAll('.panel, .choices, .push, .end-card, .continue-card, .folder, .episodes, .ui-sheet, .ui-dialog')) {
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

    // Кнопки поверх сцены и обложки — кнопки-иконки kit: зона касания 44×44, видимый круг 40, подпись для скринридера
    const kitIconButton = (selector) =>
      page.evaluate((sel) => {
        const b = document.querySelector(sel)
        if (!b?.classList.contains('ui-iconbtn') || !b.getAttribute('aria-label')) return false
        const r = b.getBoundingClientRect()
        const c = getComputedStyle(b, '::before')
        const circle = r.width - parseFloat(c.left) - parseFloat(c.right)
        return Math.round(r.width) === 44 && Math.round(r.height) === 44 && Math.round(circle) === 40
      }, selector)
    expect(await kitIconButton('.hud button'), 'чтение: кнопка меню — кнопка-иконка kit (зона касания 44×44, круг 40, подпись)')

    // 3. Меню паузы и «Назад» закрывает сначала его
    await page.locator('.hud button').first().click()
    await waitFor((x) => x.overlay, 'меню паузы')
    await page.waitForTimeout(250)
    await audit('pause')
    expect(await page.evaluate(() => document.querySelector('.app-content').inert), 'пауза: экран под шторкой недоступен (inert) — ни тапа, ни Tab')
    await back()
    await waitFor((x) => !x.overlay, 'закрытие меню паузы')
    expect((await state()).screen === s.screen, '«Назад» закрывает меню паузы и оставляет в эпизоде')
    expect(
      await page.evaluate(() => !document.querySelector('.app-content').inert && !!document.activeElement?.closest('.hud')),
      'пауза закрыта: экран снова доступен, фокус вернулся на кнопку меню',
    )

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
    if (mode === 'browser') expect(await kitIconButton('.btn-back'), 'история: своя «Назад» — кнопка-иконка kit (зона касания 44×44, круг 40, подпись)')
    else expect(!(await page.evaluate(() => !!document.querySelector('.btn-back'))), 'Telegram: на экране истории нет своей «Назад» — только системная')
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
    const closeWay = mode === 'telegram' ? 'back' : 'esc'
    expect(
      taps.some((e) => e.data?.target === 'pause.close' && e.data?.value === closeWay),
      `аналитика: как закрыли паузу — pause.close с value ${closeWay}`,
    )
    const unknownTargets = [...tapTargets].filter((x) => !UI_TARGETS.includes(x) || DEV_TARGETS.includes(x))
    expect(unknownTargets.length === 0, `аналитика: цели нажатий только из каталога, без целей стенда${unknownTargets.length ? ` — чужие: ${unknownTargets.join(', ')}` : ''}`)
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
// layout/preview.ts и ui/kit/preview.ts — стенды каркаса (layout.html) и компонентов (kit.html), в сборку игры не входят
const I18N_EXEMPT = [/^locales[\\/]/, /^api\.mock\.ts$/, /^layout[\\/]preview\.ts$/, /^ui[\\/]kit[\\/]preview\.ts$/]

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

    // 2. Пауза: размер текста — сегменты (нажатие и стрелки), потом «Начать эпизод сначала» → диалог поверх шторки
    await page.locator('.hud button').first().click()
    await page.locator('.layer--sheet').waitFor()
    await page.waitForTimeout(250)
    const textSize = () => page.evaluate(() => document.documentElement.dataset.textSize)
    await page.locator('.layer .ui-seg [data-value="l"]').click()
    expect((await textSize()) === 'l', 'пауза: «Крупнее» — текст крупнее (сегменты)')
    await page.keyboard.press('ArrowLeft')
    const afterArrow = await page.evaluate(() => document.activeElement?.dataset.value)
    expect((await textSize()) === 'm' && afterArrow === 'm', 'пауза: стрелка ← выбирает «Обычный» и переводит на него фокус')
    expect((await page.locator('.layer').count()) === 1, 'пауза: стрелки не листают эпизод под шторкой')
    await page.locator('[data-track="pause.restart"]').click()
    await page.locator('.layer--dialog').waitFor()
    await page.waitForTimeout(250)
    expect((await page.locator('.layer').count()) === 2, 'пауза: диалог «Начать сначала?» поверх шторки')
    expect(await layersInFrame(), 'шторка и диалог внутри кадра')
    await shot('restart-dialog')
    // «Назад» (Telegram) / Esc закрывает только диалог — шторка паузы остаётся, фокус — на кнопке, открывшей диалог
    const openLayers = () => page.evaluate(() => [...document.querySelectorAll('.layer')].filter((l) => !('closing' in l.dataset)).length)
    if (mode === 'telegram') await page.evaluate(() => window.__check.pressBack())
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(350)
    expect((await openLayers()) === 1 && (await page.locator('.layer--sheet').count()) === 1, '«Назад» закрывает сначала диалог, шторка паузы остаётся')
    expect((await page.evaluate(() => document.activeElement?.dataset.track)) === 'pause.restart', 'фокус вернулся на кнопку «Начать эпизод сначала»')
    // Двойной тап по «Отмена»: второй тап не закрывает шторку под диалогом и не нажимает кнопку под ним
    await page.locator('[data-track="pause.restart"]').click()
    await page.locator('.layer--dialog').waitFor()
    await page.waitForTimeout(250)
    await page.locator('.layer--dialog .btn--secondary').dblclick()
    await page.waitForTimeout(350)
    expect((await openLayers()) === 1 && (await page.locator('.layer--sheet').count()) === 1, 'двойной тап по «Отмена» не закрывает шторку под диалогом')
    await page.locator('[data-track="pause.restart"]').click()
    await page.locator('.layer--dialog').waitFor()
    await page.waitForTimeout(250)
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
    const dismissWay = mode === 'telegram' ? 'back' : 'esc'
    for (const need of ['pause.textSize:l', 'pause.textSize:m', 'pause.restart', `dialog.restart:${dismissWay}`, 'dialog.restart:cancel', 'dialog.restart:confirm', 'end.toStory', 'story.episodeReread:1', 'dialog.reread:cancel']) {
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
// Стенд компонентов (kit.html): кнопка-иконка, бейдж, чип во всех состояниях.
// Наведение, нажатие и фокус на стенде «заморожены» атрибутом data-pseudo (копии правил компонентов).
// Проверяется, что каждое состояние есть и выглядит иначе, чем обычное; зоны касания; контраст;
// подписи для скринридера; аналитика; всё внутри кадра; живые примеры — настоящими нажатиями.
// На десктопе (мышь) — что настоящие наведение, нажатие и фокус совпадают с замороженными;
// на телефоне — что наведение не «залипает».
// ---------------------------------------------------------------------------

const KIT_CASES = [
  { id: 'kit-320', label: 'компоненты', width: 320, height: 568, mobile: true },
  { id: 'kit-390', label: 'компоненты', width: 390, height: 844, mobile: true, hitShot: true },
  { id: 'kit-1440', label: 'компоненты · мышь и клавиатура', width: 1440, height: 900, mobile: false },
  { id: 'kit-390-tg', label: 'компоненты · Telegram: шторка, диалог, клавиатура', width: 390, height: 844, mobile: true, mode: 'telegram', only: ['overlay', 'keyboard'] },
  { id: 'kit-768', label: 'компоненты · планшет: клавиатура', width: 768, height: 1024, mobile: true, only: ['keyboard'] },
  { id: 'kit-844x390', label: 'компоненты · телефон боком: клавиатура', width: 844, height: 390, mobile: true, only: ['keyboard'] },
]

/**
 * Высота экранной клавиатуры, px — для каждого размера: обычная (text), цифровая (numeric) и с полосой
 * автозаполнения над ней (autofill). Порядок величин — iPhone SE, iPhone 14, iPad, телефон боком.
 */
const KEYBOARDS = {
  'kit-320': { text: 260, numeric: 216, autofill: 304 },
  'kit-390': { text: 336, numeric: 291, autofill: 380 },
  'kit-390-tg': { text: 336, numeric: 291, autofill: 380 },
  'kit-768': { text: 398, numeric: 398, autofill: 442 },
  'kit-844x390': { text: 200, numeric: 200, autofill: 236 },
}

const KIT_ICON_STATES = ['default', 'hover', 'active', 'focus', 'on', 'disabled']
const KIT_BADGES_ON_BUTTON = ['dot', 'count-1', 'count-12', 'overflow', 'label', 'alert', 'zero']
/** Строка стенда (data-row) → обязательные состояния (data-state) */
const KIT_ROWS = {
  'iconbtn-plain-m': KIT_ICON_STATES,
  'iconbtn-tonal-m': KIT_ICON_STATES,
  'iconbtn-glass-m': KIT_ICON_STATES,
  'iconbtn-plain-s': KIT_ICON_STATES,
  'iconbtn-tonal-s': KIT_ICON_STATES,
  'iconbtn-badge-m': KIT_BADGES_ON_BUTTON,
  'iconbtn-badge-s': KIT_BADGES_ON_BUTTON,
  'badge-count': ['count-1', 'count-9', 'count-12', 'count-99', 'overflow', 'zero'],
  'badge-tone': ['accent', 'alert', 'neutral', 'dot', 'dot-alert', 'label', 'label-neutral'],
  'badge-ring': ['bg', 'surface', 'sheet'],
  'chip-static': ['text', 'short', 'icon', 'count'],
  'chip-action': ['default', 'hover', 'active', 'focus', 'disabled'],
  'chip-filter': ['default', 'hover', 'active', 'focus', 'on', 'on-hover', 'disabled'],
  'chip-extra': ['count-off', 'count-on', 'long'],
}
/** Цели нажатий стенда: в каталоге есть, но в игре встречаться не должны */
const DEV_TARGETS = ['kit.demo']

function measureKit(rows) {
  const q = (s, root = document) => root.querySelector(s)
  const cell = (row, state) => q(`[data-row="${row}"] [data-state="${state}"]`)
  const r = (el) => {
    const b = el.getBoundingClientRect()
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }
  }
  const label = (el) => `.${[...el.classList].slice(0, 2).join('.')}`

  // --- Цвета и контраст (WCAG): разбор computed-цветов, наложение полупрозрачных слоёв ---
  const parseColor = (s) => {
    if (!s || s === 'transparent' || s === 'none') return [0, 0, 0, 0]
    let m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
    m = s.match(/color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)/)
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : +m[4]]
    return null
  }
  const over = (top, bottom) => {
    const a = top[3] + bottom[3] * (1 - top[3])
    if (a === 0) return [0, 0, 0, 0]
    const ch = (i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a
    return [ch(0), ch(1), ch(2), a]
  }
  const lum = ([R, G, B]) => {
    const f = (c) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B)
  }
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
  }
  /** Фон под элементом: подложка компонента (::before) поверх фонов предков, снизу — фон игры */
  const backdrop = (el, ownLayers = true) => {
    const layers = []
    if (ownLayers) {
      const b = getComputedStyle(el, '::before')
      const tint = b.backgroundImage.match(/(rgba?\([^)]*\)|color\([^)]*\))/)
      if (tint) layers.push(parseColor(tint[1]))
      layers.push(parseColor(b.backgroundColor))
    }
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = parseColor(getComputedStyle(n).backgroundColor)
      if (c && c[3] > 0) layers.push(c)
      if (c && c[3] === 1) break
    }
    let acc = parseColor(getComputedStyle(document.body).backgroundColor)
    for (const layer of layers.reverse()) if (layer) acc = over(layer, acc)
    return acc
  }

  // --- Подпись состояния: всё, чем состояния отличаются друг от друга на экране ---
  const sig = (el) => {
    const b = getComputedStyle(el, '::before')
    const s = getComputedStyle(el)
    return {
      bg: b.backgroundColor,
      tint: b.backgroundImage,
      border: b.borderTopColor,
      ring: b.boxShadow,
      transform: s.transform,
      opacity: s.opacity,
      color: s.color,
      // видимый круг / «пилюля» — вместе с рамкой
      visualW: parseFloat(b.width) + parseFloat(b.borderLeftWidth) + parseFloat(b.borderRightWidth),
      visualH: parseFloat(b.height) + parseFloat(b.borderTopWidth) + parseFloat(b.borderBottomWidth),
      margin: parseFloat(s.marginTop),
      // размеры без transform: у «нажатия» кнопка сжата scale(0.94), зона касания та же
      width: el.offsetWidth,
      height: el.offsetHeight,
    }
  }

  const missing = []
  for (const [row, states] of Object.entries(rows)) {
    for (const st of states) if (!cell(row, st)) missing.push(`${row}/${st}`)
  }

  const iconRows = Object.keys(rows).filter((x) => /^iconbtn-(plain|tonal|glass)-/.test(x))
  const icon = {}
  for (const row of iconRows) {
    icon[row] = {}
    for (const st of rows[row]) {
      const el = q('.ui-iconbtn', cell(row, st) ?? document.createElement('i'))
      if (el) icon[row][st] = sig(el)
    }
  }
  const chips = {}
  for (const row of ['chip-action', 'chip-filter']) {
    chips[row] = {}
    for (const st of rows[row]) {
      const el = q('.ui-chip', cell(row, st) ?? document.createElement('i'))
      if (el) chips[row][st] = sig(el)
    }
  }

  // --- Бейджи ---
  const badgeOf = (row, st) => q('.ui-badge', cell(row, st) ?? document.createElement('i'))
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none'
  const onButton = {}
  for (const row of ['iconbtn-badge-m', 'iconbtn-badge-s']) {
    onButton[row] = {}
    for (const st of rows[row]) {
      const btn = q('.ui-iconbtn', cell(row, st) ?? document.createElement('i'))
      const mark = btn && q('.ui-badge', btn)
      if (!btn || !mark) continue
      const br = btn.getBoundingClientRect()
      const mr = mark.getBoundingClientRect()
      onButton[row][st] = {
        aria: btn.getAttribute('aria-label') ?? '',
        title: btn.title,
        text: mark.textContent,
        shown: shown(mark),
        ariaHidden: mark.getAttribute('aria-hidden') === 'true',
        // бейдж касается круга, а не висит в стороне: пересекается с квадратом кнопки
        touches: shown(mark) ? mr.left < br.right && mr.right > br.left && mr.top < br.bottom && mr.bottom > br.top : true,
      }
    }
  }
  const one = badgeOf('badge-count', 'count-1')
  const twelve = badgeOf('badge-count', 'count-12')
  const dot = badgeOf('badge-tone', 'dot')
  const badges = {
    overflow: badgeOf('badge-count', 'overflow')?.textContent ?? '',
    zeroHidden: !shown(badgeOf('badge-count', 'zero')),
    oneCircle: !!one && Math.abs(one.offsetWidth - one.offsetHeight) <= 1,
    twelvePill: !!twelve && twelve.offsetWidth > twelve.offsetHeight,
    dot: dot ? [dot.offsetWidth, dot.offsetHeight] : [0, 0],
    dotSr: dot?.textContent ?? '',
    rings: ['bg', 'surface', 'sheet'].map((s) => {
      const c = cell('badge-ring', s)
      const mark = c && q('.ui-badge', c)
      return mark ? { ring: getComputedStyle(mark).boxShadow, surface: getComputedStyle(c).backgroundColor } : null
    }),
  }

  // --- Контраст: текст бейджей и чипов ≥ 4.5, иконка ≥ 3 (графика, WCAG 1.4.11) ---
  const contrast = []
  const text = (what, el, min = 4.5, own = true) => {
    if (!el) return contrast.push({ what, ratio: 0, min })
    const fg = parseColor(getComputedStyle(el).color)
    const bg = own === 'badge' ? parseColor(getComputedStyle(el).backgroundColor) : backdrop(el, own)
    contrast.push({ what, ratio: ratio(fg, bg), min })
  }
  for (const st of ['accent', 'alert', 'neutral', 'label', 'label-neutral']) text(`бейдж ${st}`, badgeOf('badge-tone', st), 4.5, 'badge')
  text('чип-метка', q('.ui-chip', cell('chip-static', 'text') ?? document.createElement('i')))
  text('чип-действие', q('.ui-chip', cell('chip-action', 'default') ?? document.createElement('i')))
  text('чип-фильтр', q('.ui-chip', cell('chip-filter', 'default') ?? document.createElement('i')))
  text('чип-фильтр выбран', q('.ui-chip', cell('chip-filter', 'on') ?? document.createElement('i')))
  text('кнопка-иконка plain', q('.ui-iconbtn', cell('iconbtn-plain-m', 'default') ?? document.createElement('i')), 3)
  text('кнопка-иконка tonal', q('.ui-iconbtn', cell('iconbtn-tonal-m', 'default') ?? document.createElement('i')), 3)
  text('кнопка-иконка включена', q('.ui-iconbtn', cell('iconbtn-plain-m', 'on') ?? document.createElement('i')), 3)

  // --- Чипы: галочка у выбранного, счётчик, длинный текст ---
  const onChip = q('.ui-chip', cell('chip-filter', 'on') ?? document.createElement('i'))
  const offChip = q('.ui-chip', cell('chip-filter', 'default') ?? document.createElement('i'))
  const countOn = q('.ui-chip__count', cell('chip-extra', 'count-on') ?? document.createElement('i'))
  const longCell = cell('chip-extra', 'long')
  const longChip = longCell && q('.ui-chip', longCell)
  const longText = longChip && q('.ui-chip__text', longChip)
  const staticChip = q('.ui-chip', cell('chip-static', 'text') ?? document.createElement('i'))
  const chipExtra = {
    checkOn: !!onChip && shown(q('.ui-chip__check', onChip)),
    checkOff: !!offChip && shown(q('.ui-chip__check', offChip)),
    pressedOn: onChip?.getAttribute('aria-pressed'),
    pressedOff: offChip?.getAttribute('aria-pressed'),
    countOnBg: countOn ? getComputedStyle(countOn).backgroundColor : '',
    brass: getComputedStyle(document.documentElement).getPropertyValue('--brass').trim(),
    longTruncated: !!longText && longText.scrollWidth > longText.clientWidth + 1,
    longInside: !!longChip && longChip.getBoundingClientRect().right <= longCell.getBoundingClientRect().right + 1,
    staticH: staticChip ? staticChip.getBoundingClientRect().height : 0,
    staticTag: staticChip?.tagName ?? '',
  }

  // --- Доступность и аналитика ---
  const allIconBtns = [...document.querySelectorAll('.ui-iconbtn')]
  const groups = [...document.querySelectorAll('.ui-chips')]
  const filters = [...document.querySelectorAll('.ui-chip[data-kind="filter"]')]
  const a11y = {
    unlabeled: allIconBtns.filter((b) => !(b.getAttribute('aria-label') ?? '').trim()).length,
    groupsOk: groups.length > 0 && groups.every((g) => g.getAttribute('role') === 'group' && (g.getAttribute('aria-label') ?? '').trim()),
    filtersPressed: filters.length > 0 && filters.every((c) => ['true', 'false'].includes(c.getAttribute('aria-pressed'))),
    disabledNative: [...document.querySelectorAll('[data-state="disabled"] .ui-iconbtn, [data-state="disabled"] .ui-chip')].every((b) => b.disabled),
  }
  const buttons = [...document.querySelectorAll('button')]
  const untracked = buttons.filter((b) => !b.disabled && !b.dataset.track).map(label)
  const targets = [...new Set(buttons.map((b) => b.dataset.track).filter(Boolean))]
  const small = [...new Set(buttons.filter((b) => b.offsetParent && (b.offsetWidth < 44 || b.offsetHeight < 44)).map(label))]

  // --- Кадр ---
  const shell = q('.app-shell')
  const f = r(shell)
  const outside = []
  for (const el of document.querySelectorAll('.kit-spec, .kit-live, .kit-mock-header, .kit-list, .ui-iconbtn, .ui-chip, .ui-badge')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0) continue
    if (b.left < f.left - 1 || b.right > f.right + 1) outside.push(label(el))
  }
  const doc = document.scrollingElement

  return {
    ready: document.documentElement.dataset.kitReady,
    missing,
    icon,
    chips,
    onButton,
    badges,
    contrast,
    chipExtra,
    a11y,
    untracked: [...new Set(untracked)],
    targets,
    small,
    frame: f,
    outside: [...new Set(outside)],
    hScroll: doc.scrollWidth > innerWidth + 1,
    docLocked: doc.scrollHeight <= innerHeight + 1,
    headerShown: getComputedStyle(q('.app-header')).display !== 'none',
    tabbarShown: getComputedStyle(q('.app-tabbar')).display !== 'none',
  }
}

/** Подпись состояния без размеров — для сравнения «выглядит иначе / так же» */
const look = (s) => (s ? JSON.stringify([s.bg, s.tint, s.border, s.ring, s.transform, s.opacity, s.color]) : '')

async function runKitCase(browser, kitUrl, c) {
  const vp = { id: c.id, width: c.width, height: c.height, mobile: c.mobile }
  const mode = c.mode ?? 'browser'
  const { res, context, page, expect, fail } = await openCase(browser, vp, mode, { id: c.id, label: c.label })
  const ICON_SIZE = { m: 40, s: 32 }
  try {
    await page.addInitScript(fakeKeyboard)
    await page.goto(kitUrl)
    await page.waitForSelector('[data-kit-ready]')
    await page.waitForTimeout(400) // переходы (transition) закончились
    if (c.only) {
      // Компоненты 2.1 уже проверены — здесь только слои (Telegram «Назад») и клавиатура на этом размере
      if (c.only.includes('overlay')) await checkOverlays(page, c, expect, res)
      if (c.only.includes('keyboard')) await checkKeyboard(page, c, expect, res)
      await context.close()
      return res
    }
    const m = await page.evaluate(measureKit, KIT_ROWS)

    // 1. Все состояния на стенде
    expect(Number(m.ready) > 0, `стенд: замороженные состояния подключены (правил: ${m.ready})`)
    expect(m.missing.length === 0, `стенд: все состояния на месте${m.missing.length ? ` — нет: ${m.missing.join(', ')}` : ''}`)

    // 2. Кнопка-иконка: каждое состояние видно, зона касания 44, круг 40 / 32
    for (const [row, st] of Object.entries(m.icon)) {
      const size = ICON_SIZE[row.endsWith('-s') ? 's' : 'm']
      const d = st.default
      const differs = (x) => look(st[x]) !== look(d)
      expect(differs('hover') && st.hover.bg !== d.bg, `${row}: наведение видно`)
      expect(differs('active') && st.active.transform !== 'none', `${row}: нажатие видно (подложка и сжатие)`)
      expect(st.focus.ring !== 'none' && d.ring === 'none', `${row}: фокус с клавиатуры — кольцо`)
      expect(st.on.color !== d.color && st.on.border !== d.border, `${row}: «включена» — латунная иконка и обводка`)
      expect(Number(st.disabled.opacity) < 1, `${row}: «недоступна» приглушена`)
      const sizesOk = Object.values(st).every((s) => s.width === 44 && s.height === 44 && Math.round(s.visualW) === size && Math.round(s.visualH) === size)
      expect(sizesOk, `${row}: зона касания 44×44, виден круг ${size} px`)
      expect(Math.round(d.margin) === -(44 - size) / 2, `${row}: в раскладке занимает только круг (поля ${-(44 - size) / 2} px)`)
    }

    // 3. Бейдж на кнопке: подпись для скринридера и всплывашка
    for (const [row, st] of Object.entries(m.onButton)) {
      const ok =
        st.dot?.shown && /есть новое/.test(st.dot.aria) &&
        st['count-1']?.text === '1' && /: 1 новое$/.test(st['count-1'].aria) &&
        st['count-12']?.text === '12' && /: 12 новых$/.test(st['count-12'].aria) &&
        st.overflow?.text === '99+' && /: 120 новых$/.test(st.overflow.aria) &&
        st.label?.text === 'Новое' && /: Новое$/.test(st.label.aria) &&
        st.zero && !st.zero.shown && st.zero.aria === 'Уведомления'
      expect(!!ok, `${row}: бейдж и подпись для скринридера («Уведомления: 120 новых», при 0 — без бейджа)`)
      const vals = Object.values(st)
      expect(vals.length > 0 && vals.every((s) => s.ariaHidden && s.title === s.aria), `${row}: бейдж скрыт от скринридера, всплывашка = подпись`)
      expect(vals.every((s) => s.touches), `${row}: бейдж сидит на кнопке`)
    }

    // 4. Бейдж отдельно
    const b = m.badges
    expect(b.overflow === '99+' && b.zeroHidden, 'бейдж: больше 99 — «99+», 0 — скрыт')
    expect(b.oneCircle && b.twelvePill, 'бейдж: одна цифра — круг, две — «пилюля»')
    expect(b.dot[0] === 8 && b.dot[1] === 8 && b.dotSr === 'Есть новое', 'бейдж: точка 8 px, для скринридера — «Есть новое»')
    const ringsOk = b.rings.every((x) => x && x.ring.startsWith(x.surface))
    expect(ringsOk, 'бейдж: обводка цветом подложки (фон, поверхность, шторка)')

    // 5. Чип
    for (const [row, st] of Object.entries(m.chips)) {
      const d = st.default
      expect(look(st.hover) !== look(d) && st.hover.bg !== d.bg, `${row}: наведение видно`)
      expect(st.active.transform !== 'none', `${row}: нажатие видно (сжатие)`)
      expect(st.focus.ring !== 'none' && d.ring === 'none', `${row}: фокус с клавиатуры — кольцо`)
      expect(Number(st.disabled.opacity) < 1, `${row}: «недоступен» приглушён`)
      expect(Object.values(st).every((s) => s.height === 44 && Math.round(s.visualH) === 32), `${row}: зона касания 44 px по высоте, видна «пилюля» 32 px`)
    }
    const f = m.chips['chip-filter']
    expect(f.on.color !== f.default.color && f.on.border !== f.default.border, 'фильтр: «выбран» — латунный текст и обводка')
    expect(look(f['on-hover']) !== look(f.on), 'фильтр: наведение на выбранный тоже видно')
    const cx = m.chipExtra
    expect(cx.checkOn && !cx.checkOff && cx.pressedOn === 'true' && cx.pressedOff === 'false', 'фильтр: выбранный — с галочкой и aria-pressed, не только цветом')
    expect(cx.countOnBg && parseColorNode(cx.countOnBg) === parseColorNode(cx.brass), 'фильтр: счётчик выбранного — латунный')
    expect(cx.longTruncated && cx.longInside, 'чип: длинный текст обрезается многоточием, чип не шире ряда')
    expect(cx.staticTag === 'SPAN' && Math.round(cx.staticH) === 28, 'чип-метка: не кнопка, высота 28 px')

    // 6. Контраст
    const low = m.contrast.filter((x) => x.ratio < x.min)
    expect(low.length === 0, `контраст: текст ≥ 4.5, иконки ≥ 3${low.length ? ` — мало: ${low.map((x) => `${x.what} ${x.ratio}`).join(', ')}` : ''}`)

    // 7. Доступность, аналитика, зоны касания
    expect(m.a11y.unlabeled === 0, 'у каждой кнопки-иконки есть подпись для скринридера')
    expect(m.a11y.groupsOk && m.a11y.filtersPressed, 'группа фильтров — role="group" с подписью, у фильтров aria-pressed')
    expect(m.a11y.disabledNative, '«недоступна» — настоящий disabled: не нажимается и не в порядке Tab')
    expect(m.untracked.length === 0, `у каждой кнопки есть цель аналитики${m.untracked.length ? ` — нет у ${m.untracked.join(', ')}` : ''}`)
    const foreign = m.targets.filter((x) => !UI_TARGETS.includes(x))
    expect(foreign.length === 0, `цели нажатий из каталога${foreign.length ? ` — чужие: ${foreign.join(', ')}` : ''}`)
    expect(m.small.length === 0, `все кнопки не меньше 44×44${m.small.length ? ` — меньше: ${m.small.join(', ')}` : ''}`)
    // Скругление элемента сужает зону нажатия до вписанного круга — углы квадрата должны нажиматься
    const cornerHit = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)
        el.scrollIntoView({ block: 'center' })
        const b = el.getBoundingClientRect()
        const corners = [
          [b.left + 1.5, b.top + 1.5],
          [b.right - 1.5, b.top + 1.5],
          [b.left + 1.5, b.bottom - 1.5],
          [b.right - 1.5, b.bottom - 1.5],
        ]
        return corners.every(([x, y]) => el.contains(document.elementFromPoint(x, y)))
      }, sel)
    expect(await cornerHit('[data-row="iconbtn-plain-m"] [data-state="default"] .ui-iconbtn'), 'кнопка-иконка нажимается во всём квадрате 44×44, включая углы')
    expect(await cornerHit('[data-row="chip-filter"] [data-state="default"] .ui-chip'), 'чип нажимается во всей полосе 44 px, включая углы')

    // 8. Кадр
    expect(m.outside.length === 0, `всё внутри кадра${m.outside.length ? ` — снаружи: ${m.outside.join(', ')}` : ''}`)
    expect(!m.hScroll && m.docLocked, 'документ зафиксирован, горизонтальной прокрутки нет')
    expect(m.headerShown && !m.tabbarShown, 'каркас: хедер со стендом, пустой таббар скрыт')

    // 9. Настоящие наведение, нажатие, фокус
    const sigOf = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)
        const bf = getComputedStyle(el, '::before')
        const cs = getComputedStyle(el)
        return JSON.stringify([bf.backgroundColor, bf.backgroundImage, bf.borderTopColor, bf.boxShadow, cs.transform, cs.opacity, cs.color])
      }, sel)
    const realIcon = '[data-row="iconbtn-plain-m"] [data-state="default"] .ui-iconbtn'
    const realChip = '[data-row="chip-filter"] [data-state="default"] .ui-chip'
    const ic = m.icon['iconbtn-plain-m']
    const ch = m.chips['chip-filter']
    await page.locator(realIcon).scrollIntoViewIfNeeded()
    await page.locator(realIcon).hover()
    await page.waitForTimeout(300)
    if (c.mobile) {
      expect((await sigOf(realIcon)) === look(ic.default), 'телефон: наведение не «залипает» после касания')
    } else {
      expect((await sigOf(realIcon)) === look(ic.hover), 'мышь: настоящее наведение = замороженное на стенде')
      await page.mouse.down()
      await page.waitForTimeout(300)
      const pressed = await sigOf(realIcon)
      await page.mouse.up()
      expect(pressed === look(ic.active), 'мышь: настоящее нажатие = замороженное')
      await page.locator(realChip).scrollIntoViewIfNeeded()
      await page.locator(realChip).hover()
      await page.waitForTimeout(300)
      expect((await sigOf(realChip)) === look(ch.hover), 'мышь: наведение на чип = замороженное')
      await page.mouse.move(2, 2)
      await page.keyboard.press('Tab')
      await page.locator(realIcon).focus()
      await page.waitForTimeout(300)
      expect((await sigOf(realIcon)) === look(ic.focus), 'клавиатура: фокус на кнопке = замороженный')
      await page.locator(realChip).focus()
      await page.waitForTimeout(300)
      expect((await sigOf(realChip)) === look(ch.focus), 'клавиатура: фокус на чипе = замороженный')
    }

    // 10. Живые примеры — настоящими нажатиями
    const live = (sel) => page.locator(`[data-live-box] ${sel}`)
    const bell = live('.ui-iconbtn[aria-expanded]')
    await bell.scrollIntoViewIfNeeded()
    await bell.click()
    const afterOpen = await bell.evaluate((el) => ({ expanded: el.getAttribute('aria-expanded'), aria: el.getAttribute('aria-label'), badge: getComputedStyle(el.querySelector('.ui-badge')).display }))
    expect(afterOpen.expanded === 'true' && afterOpen.badge === 'none' && afterOpen.aria === 'Уведомления', 'живой пример: открыли уведомления — панель открыта, бейдж ушёл')
    await live('.ui-chip[data-kind="action"]').first().click()
    await page.waitForTimeout(100)
    const afterAdd = await bell.evaluate((el) => ({ aria: el.getAttribute('aria-label'), text: el.querySelector('.ui-badge').textContent }))
    expect(afterAdd.text === '1' && afterAdd.aria === 'Уведомления: 1 новое', 'живой пример: новое уведомление — бейдж «1» и подпись обновились')
    const big = live('.ui-iconbtn[aria-pressed]')
    await big.click()
    expect((await big.getAttribute('aria-pressed')) === 'true', 'живой пример: переключатель включается (aria-pressed)')

    const genre = (name) => page.locator('[data-live-box="chip"] .ui-chip[data-kind="filter"]', { hasText: name })
    const readout = page.locator('[data-live="chip"]')
    await genre('Мистика').scrollIntoViewIfNeeded()
    await genre('Мистика').click()
    expect((await genre('Мистика').getAttribute('aria-pressed')) === 'true' && /Мистика/.test(await readout.textContent()), 'живой пример: фильтр выбирается касанием')
    if (!c.mobile) {
      await genre('Драма').focus()
      await page.keyboard.press('Space')
      const bySpace = await genre('Драма').getAttribute('aria-pressed')
      await page.keyboard.press('Enter')
      const byEnter = await genre('Драма').getAttribute('aria-pressed')
      expect(bySpace === 'true' && byEnter === 'false', 'клавиатура: фильтр переключается пробелом и Enter')
    }
    await page.locator('[data-live-box="chip"] .ui-chip[data-kind="action"]').click()
    const anyPressed = await page.locator('[data-live-box="chip"] .ui-chip[aria-pressed="true"]').count()
    expect(anyPressed === 0 && (await readout.textContent()) === 'Ничего не выбрано', 'живой пример: «Сбросить» снимает все фильтры')

    // 11. Шторка и диалог
    await checkOverlays(page, c, expect, res)

    // 12. Переключатель и сегменты; поле ввода и клавиатура
    await checkControls(page, c, expect)
    await checkKeyboard(page, c, expect, res)

    // 13. Скриншоты
    if (c.mobile) {
      // Каждый раздел целиком: кадр телефона растягивается на высоту раздела
      const sections = await page.evaluate(() =>
        [...document.querySelectorAll('[data-section]')].map((s) => ({ id: s.dataset.section, top: s.offsetTop, height: s.offsetHeight })),
      )
      const headerH = await page.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().height)
      const NAMES = { iconbtn: 'кнопка-иконка', badge: 'бейдж', chip: 'чип', overlay: 'шторка и диалог: кнопки', controls: 'переключатель и сегменты', field: 'поле ввода' }
      const shotSection = async (s, name, file) => {
        await page.setViewportSize({ width: c.width, height: Math.ceil(headerH + s.height + 24) })
        await page.evaluate((top) => (document.querySelector('.app-content').scrollTop = top - 8), s.top)
        await page.waitForTimeout(150)
        await page.screenshot({ path: join(OUT, file) })
        res.shots.push({ name, file })
      }
      for (const s of sections) await shotSection(s, NAMES[s.id] ?? s.id, `${c.id}-${s.id}.png`)
      if (c.hitShot) {
        await page.locator('.kit-controls .ui-chip').click()
        await shotSection(sections[0], 'зоны касания 44 px', `${c.id}-hit.png`)
      }
    } else {
      await page.evaluate(() => (document.querySelector('.app-content').scrollTop = 0))
      await page.mouse.move(2, 2)
      await page.waitForTimeout(200)
      await page.screenshot({ path: join(OUT, `${c.id}.png`) })
      res.shots.push({ name: 'стенд в кадре десктопа', file: `${c.id}.png` })
    }
  } catch (error) {
    fail(`сценарий прерван: ${error.message.split('\n')[0]}`)
  }
  await context.close()
  return res
}

/**
 * Имитация экранной клавиатуры iOS: она перекрывает экран — уменьшается только visualViewport
 * (height), а iOS может ещё сдвинуть страницу (offsetTop). Выполняется в странице до её скриптов.
 * window.__kb.open(высота, сдвиг) / close(). Android-вариант (экран ужимается) — это setViewportSize.
 */
function fakeKeyboard() {
  const real = window.visualViewport
  const listeners = { resize: new Set(), scroll: new Set() }
  const st = { kb: 0, pan: 0 }
  const fake = {
    get width() {
      return real ? real.width : innerWidth
    },
    get height() {
      return Math.max(0, document.documentElement.clientHeight - st.kb)
    },
    get offsetTop() {
      return st.pan
    },
    offsetLeft: 0,
    get pageTop() {
      return st.pan
    },
    pageLeft: 0,
    scale: 1,
    addEventListener(type, fn) {
      ;(listeners[type] ??= new Set()).add(fn)
    },
    removeEventListener(type, fn) {
      listeners[type]?.delete(fn)
    },
  }
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake })
  const fire = () => {
    for (const type of ['resize', 'scroll']) for (const fn of listeners[type] ?? []) fn(new Event(type))
  }
  window.addEventListener('resize', fire) // настоящее изменение окна — как у браузера: visualViewport тоже
  window.__kb = {
    open(kb, pan = 0) {
      st.kb = kb
      st.pan = pan
      fire()
    },
    close() {
      st.kb = 0
      st.pan = 0
      fire()
    },
  }
}

/** Переключатель и сегменты: роли, состояния видны, переключение касанием и с клавиатуры */
async function checkControls(page, c, expect) {
  const m = await page.evaluate(() => {
    const cell = (row, st) => document.querySelector(`[data-row="${row}"] [data-state="${st}"]`)
    const sw = (st) => cell('switch-states', st)?.querySelector('.ui-switch')
    const look = (el) => {
      if (!el) return null
      const track = el.querySelector('.ui-switch__track')
      const thumb = el.querySelector('.ui-switch__thumb')
      const t = getComputedStyle(track)
      return { bg: t.backgroundColor, border: t.borderTopColor, ring: t.boxShadow, thumbW: thumb.offsetWidth, thumbX: thumb.getBoundingClientRect().left - track.getBoundingClientRect().left, opacity: getComputedStyle(el).opacity, h: el.offsetHeight }
    }
    const switches = {}
    for (const st of ['off', 'on', 'hover', 'active', 'focus', 'disabled-off', 'disabled-on']) switches[st] = look(sw(st))
    const hinted = cell('switch-extra', 'hint')?.querySelector('.ui-switch')
    const name = (el) => (el?.getAttribute('aria-labelledby') ? document.getElementById(el.getAttribute('aria-labelledby'))?.textContent : '')
    const desc = (el) => (el?.getAttribute('aria-describedby') ? document.getElementById(el.getAttribute('aria-describedby'))?.textContent : '')

    const segs = [...document.querySelectorAll('[data-row="seg-states"] .ui-seg')]
    const segInfo = segs.map((g) => {
      const items = [...g.querySelectorAll('.ui-seg__item')]
      const checked = items.filter((i) => i.getAttribute('aria-checked') === 'true')
      const tabbable = items.filter((i) => i.tabIndex === 0)
      const idx = items.indexOf(checked[0])
      const indicator = getComputedStyle(g, '::before')
      return {
        state: g.closest('[data-state]').dataset.state,
        role: g.getAttribute('role'),
        radios: items.every((i) => i.getAttribute('role') === 'radio'),
        checked: checked.length,
        tabbable: tabbable.length,
        tabOk: checked.length ? tabbable[0] === checked[0] : tabbable.length === 1 && !tabbable[0].disabled,
        indexOk: !checked.length || Number(getComputedStyle(g).getPropertyValue('--i')) === idx,
        indicatorW: parseFloat(indicator.width),
        itemW: items[0].getBoundingClientRect().width,
        indicatorHidden: indicator.opacity === '0',
        minH: Math.min(...items.map((i) => i.offsetHeight)),
      }
    })
    const segItem = (st, value) => cell('seg-states', st)?.querySelector(`[data-value="${value}"]`)
    const segLook = (el) => (el ? JSON.stringify([getComputedStyle(el).color, getComputedStyle(el).backgroundColor, getComputedStyle(el).boxShadow, getComputedStyle(el).transform]) : '')
    return {
      switches,
      roles: [...document.querySelectorAll('.ui-switch')].every((el) => el.getAttribute('role') === 'switch' && ['true', 'false'].includes(el.getAttribute('aria-checked'))),
      hintName: name(hinted),
      hintDesc: desc(hinted),
      segInfo,
      segHover: segLook(segItem('hover', 'light')) !== segLook(segItem('default', 'light')),
      segActive: segLook(segItem('active', 'light')) !== segLook(segItem('default', 'light')),
      segFocus: segLook(segItem('focus', 'light')) !== segLook(segItem('last', 'light')),
    }
  })
  const s = m.switches
  expect(m.roles, 'переключатель: role="switch" и aria-checked у каждого')
  expect(s.off && s.on && s.on.bg !== s.off.bg && s.on.thumbX > s.off.thumbX, 'переключатель: включён — латунная дорожка, рычажок справа (не только цвет)')
  expect(s.hover && s.hover.border !== s.off.border, 'переключатель: наведение видно')
  expect(s.active && s.active.thumbW > s.on.thumbW, 'переключатель: нажатие — рычажок вытягивается')
  expect(s.focus && s.focus.ring !== 'none' && s.off.ring === 'none', 'переключатель: фокус с клавиатуры — кольцо')
  expect(Number(s['disabled-off']?.opacity) < 1 && Number(s['disabled-on']?.opacity) < 1, 'переключатель: «недоступен» приглушён в обоих положениях')
  expect(Object.values(s).every((x) => x && x.h >= 56), 'переключатель: строка не ниже 56 px — нажимается целиком')
  expect(m.hintName === 'Уведомления о новых эпизодах' && /Бот напишет/.test(m.hintDesc), 'переключатель: имя — подпись, пояснение — описание для скринридера')

  const segBad = m.segInfo.filter((g) => !(g.role === 'radiogroup' && g.radios && g.tabOk && g.indexOk && g.minH >= 44 && g.checked <= 1))
  expect(m.segInfo.length >= 8 && segBad.length === 0, `сегменты: radiogroup, один выбранный, в порядке Tab — только он, ползунок под ним, высота ≥ 44${segBad.length ? ` — не так: ${segBad.map((g) => g.state).join(', ')}` : ''}`)
  const empty = m.segInfo.find((g) => g.state === 'empty')
  expect(!!empty && empty.checked === 0 && empty.indicatorHidden && empty.tabbable === 1, 'сегменты: ничего не выбрано — ползунка нет, в группу можно попасть Tab')
  const first = m.segInfo.find((g) => g.state === 'default')
  expect(!!first && Math.abs(first.indicatorW - first.itemW) <= 1, 'сегменты: ползунок шириной в сегмент')
  expect(m.segHover && m.segActive && m.segFocus, 'сегменты: наведение, нажатие и фокус видны')

  // Живые: касанием и с клавиатуры
  const live = '[data-live-box="controls"]'
  const readout = page.locator('[data-live="controls"]')
  const music = page.locator(`${live} .ui-switch`, { hasText: 'Музыка' })
  await music.scrollIntoViewIfNeeded()
  await music.click()
  expect((await music.getAttribute('aria-checked')) === 'true' && /Музыка/.test(await readout.textContent()), 'переключатель: касание включает (вся строка)')
  const light = page.locator(`${live} .ui-seg [data-value="light"]`)
  await light.click()
  expect((await light.getAttribute('aria-checked')) === 'true' && /тема: light/.test(await readout.textContent()), 'сегменты: касание выбирает вариант')
  if (!c.mobile) {
    await music.focus()
    await page.keyboard.press('Space')
    expect((await music.getAttribute('aria-checked')) === 'false', 'клавиатура: пробел переключает')
    await light.focus()
    await page.keyboard.press('ArrowRight')
    const right = await page.evaluate((sel) => document.activeElement?.closest(sel) && document.activeElement.dataset.value, live)
    await page.keyboard.press('ArrowRight')
    const wrapped = await page.evaluate(() => document.activeElement?.dataset.value)
    await page.keyboard.press('End')
    const end = await page.evaluate(() => document.activeElement?.dataset.value)
    expect(right === 'auto' && wrapped === 'dark' && end === 'auto' && /тема: auto/.test(await readout.textContent()), 'клавиатура: стрелки и End переводят выбор по кругу')
    // Недоступный вариант пропускается
    await page.locator('[data-state="option-disabled"] .ui-seg [data-value="dark"]').focus()
    await page.keyboard.press('ArrowRight')
    expect((await page.evaluate(() => document.activeElement?.dataset.value)) === 'auto', 'клавиатура: недоступный вариант пропускается')
  }
}

/**
 * Поле ввода и экранная клавиатура: правильная клавиатура под вид поля; поле внизу экрана, в шторке
 * и после появления ошибки — над клавиатурой; iOS сдвинул страницу; Android ужал экран; таббар прячется.
 */
async function checkKeyboard(page, c, expect, res) {
  const kb = KEYBOARDS[c.id] // нет — десктоп: экранной клавиатуры нет
  const H = c.height
  const settle = () => page.waitForTimeout(480)
  const field = (name) => `[data-field="${name}"]`

  // Вид поля → клавиатура и поведение
  const kinds = await page.evaluate(() => {
    const attrs = (name) => {
      const i = document.querySelector(`[data-field="${name}"] input`)
      const label = i && document.querySelector(`label[for="${i.id}"]`)
      return i && {
        type: i.type,
        inputmode: i.getAttribute('inputmode'),
        autocapitalize: i.getAttribute('autocapitalize'),
        spellcheck: i.getAttribute('spellcheck'),
        autocomplete: i.getAttribute('autocomplete'),
        enterkeyhint: i.getAttribute('enterkeyhint'),
        pattern: i.getAttribute('pattern'),
        font: parseFloat(getComputedStyle(i).fontSize),
        label: label?.textContent ?? '',
        height: i.closest('.ui-field__box').offsetHeight,
      }
    }
    return { code: attrs('kind-code'), number: attrs('kind-number'), email: attrs('kind-email'), search: attrs('kind-search'), name: attrs('name') }
  })
  const k = kinds
  expect(k.code?.autocapitalize === 'characters' && k.code.spellcheck === 'false' && k.code.autocomplete === 'off' && k.code.enterkeyhint === 'go', 'промокод: заглавные, без автозамены и подсказок, Enter — «Перейти»')
  expect(k.number?.inputmode === 'numeric' && k.number.pattern === '[0-9]*', 'цифры: цифровая клавиатура (inputmode numeric, pattern для iOS)')
  expect(k.email?.type === 'email' && k.email.inputmode === 'email' && k.email.autocomplete === 'email' && k.email.autocapitalize === 'none', 'почта: клавиатура с @ и автозаполнение адреса')
  expect(k.search?.enterkeyhint === 'search' && k.search.inputmode === 'search', 'поиск: кнопка «Найти» на клавиатуре')
  expect(Object.values(k).every((x) => x && x.font >= 16 && x.height >= 44 && x.label), 'поля: шрифт ≥ 16 px (iOS не приближает), высота ≥ 44, подпись связана с полем')

  if (!kb) {
    // Десктоп: экранной клавиатуры нет — фокус в поле кадр не трогает; Enter переводит к следующему полю
    await page.locator(`${field('name')} input`).scrollIntoViewIfNeeded()
    await page.locator(`${field('name')} input`).focus()
    await settle()
    const d = await page.evaluate(() => document.querySelector('.app-shell').dataset.keyboard ?? '')
    await page.keyboard.type('Вера')
    await page.keyboard.press('Enter')
    const next = await page.evaluate(() => document.activeElement?.closest('[data-field]')?.dataset.field)
    expect(d === '' && next === 'email', 'десктоп: фокус в поле не считается клавиатурой; Enter («Далее») — к следующему полю')
    await page.locator(`${field('name')} .ui-field__clear`).click()
    const cleared = await page.evaluate(() => ({ v: document.querySelector('[data-field="name"] input').value, f: document.activeElement?.closest('[data-field]')?.dataset.field }))
    expect(cleared.v === '' && cleared.f === 'name', 'крестик очищает поле и оставляет в нём фокус')
    return
  }

  // Таббар — чтобы проверить, что он прячется на время ввода
  await page.evaluate(() => document.querySelector('[data-slot="tabbar"]').append(Object.assign(document.createElement('span'), { className: 'kb-test-tab', textContent: 'таббар' })))
  await page.waitForTimeout(100)

  /** Где поле относительно видимой части экрана над клавиатурой */
  const where = (name, kbPx, pan = 0) =>
    page.evaluate(
      ({ sel, kbPx, pan, H }) => {
        const f = document.querySelector('.app-shell')
        const fr = f.getBoundingClientRect()
        const zoneTop = Math.max(fr.top, document.querySelector('.app-header').getBoundingClientRect().bottom)
        const box = document.querySelector(sel)
        const r = box.getBoundingClientRect()
        const sheet = box.closest('.ui-sheet')
        const body = sheet?.querySelector('.ui-sheet__body').getBoundingClientRect()
        const visibleBottom = H - kbPx + pan // низ видимой части в координатах страницы
        return {
          frameTop: fr.top,
          frameBottom: fr.bottom,
          visibleBottom,
          fieldTop: r.top,
          fieldBottom: r.bottom,
          zoneTop: sheet ? body.top : zoneTop,
          sheetBottom: sheet ? sheet.getBoundingClientRect().bottom : null,
          sheetTop: sheet ? sheet.getBoundingClientRect().top : null,
          keyboard: f.dataset.keyboard ?? '',
          tabbar: getComputedStyle(document.querySelector('.app-tabbar')).display !== 'none',
          focused: box.contains(document.activeElement),
        }
      },
      { sel: name.startsWith('[') ? name : field(name), kbPx, pan, H },
    )
  const visible = (w, air = 8) => w.fieldTop >= w.zoneTop - 1 && w.fieldBottom <= w.visibleBottom - air && w.focused

  // 1. Последнее поле внизу экрана, обычная клавиатура (iOS: перекрывает экран)
  await page.evaluate(() => {
    const z = document.querySelector('.app-content')
    z.scrollTop = z.scrollHeight
  })
  await page.locator(`${field('promo')} input`).focus()
  await page.evaluate((px) => window.__kb.open(px), kb.text)
  await settle()
  let w = await where('promo', kb.text)
  expect(Math.abs(w.frameBottom - (H - kb.text)) <= 1 && w.keyboard === 'open', `клавиатура ${kb.text} px: кадр встал над ней`)
  expect(visible(w), `клавиатура ${kb.text} px: поле внизу экрана вместе с подписью и подсказкой — над клавиатурой`)
  expect(!w.tabbar, 'клавиатура открыта — таббар спрятан')
  await page.keyboard.type('namertvo')
  const typed = await page.evaluate((sel) => ({ v: document.querySelector(`${sel} input`).value, counter: document.querySelector(`${sel} .ui-field__counter`)?.textContent }), field('promo'))
  expect(typed.v === 'namertvo' && typed.counter === '8/16', 'ввод: текст и счётчик «8/16»')
  await page.keyboard.press('Enter')
  expect(/NAMERTVO отправлен/.test(await page.locator('[data-live="field"]').textContent()), 'Enter («Перейти») отправляет промокод — заглавными')

  // 2. iOS сдвинул страницу вверх — кадр едет следом, поле по-прежнему видно
  await page.evaluate((px) => window.__kb.open(px, 120), kb.text)
  await settle()
  w = await where('promo', kb.text, 120)
  expect(Math.abs(w.frameTop - 120) <= 1 && Math.abs(w.frameBottom - (H - kb.text + 120)) <= 1 && visible(w), 'iOS сдвинул страницу: кадр — ровно в видимой части, поле на виду')

  // 3. Закрыли клавиатуру — кадр на весь экран, таббар вернулся
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.__kb.close()
  })
  await settle()
  w = await where('promo', 0)
  expect(Math.abs(w.frameTop) <= 1 && Math.abs(w.frameBottom - H) <= 1 && w.keyboard === '' && w.tabbar, 'клавиатура закрыта: кадр на весь экран, таббар вернулся')

  // 4. Цифровое поле у нижнего края — цифровая клавиатура; нецифры не вводятся
  await page.evaluate((sel) => {
    const z = document.querySelector('.app-content')
    const r = document.querySelector(sel).getBoundingClientRect()
    z.scrollTop += r.bottom - z.getBoundingClientRect().bottom + 4 // поле у самого края экрана
  }, field('number'))
  await page.locator(`${field('number')} input`).focus()
  await page.evaluate((px) => window.__kb.open(px), kb.numeric)
  await settle()
  w = await where('number', kb.numeric)
  expect(visible(w), `цифровая клавиатура ${kb.numeric} px: поле над ней`)
  await page.keyboard.type('19a8b7')
  expect((await page.locator(`${field('number')} input`).inputValue()) === '1987', 'цифры: буквы не вводятся')

  // 5. Почта с полосой автозаполнения над клавиатурой
  await page.locator(`${field('email')} input`).focus()
  await page.evaluate((px) => window.__kb.open(px), kb.autofill)
  await settle()
  w = await where('email', kb.autofill)
  expect(visible(w), `клавиатура с автозаполнением ${kb.autofill} px: поле почты над ней`)
  await page.evaluate(() => {
    document.activeElement?.blur()
    window.__kb.close()
  })
  await settle()

  // 6. Промокод в шторке: шторка поднимается над клавиатурой; ошибка под полем тоже видна
  await page.locator('[data-live-box="field"] [data-open="promo"]').scrollIntoViewIfNeeded()
  await page.locator('[data-live-box="field"] [data-open="promo"]').click()
  await page.waitForTimeout(350)
  await page.locator(`${field('sheet-promo')} input`).focus()
  await page.evaluate((px) => window.__kb.open(px), kb.text)
  await settle()
  w = await where('sheet-promo', kb.text)
  expect(w.sheetBottom !== null && w.sheetBottom <= w.visibleBottom + 1 && w.sheetTop >= w.frameTop - 1, `шторка с полем: над клавиатурой ${kb.text} px и внутри кадра`)
  expect(visible(w), 'шторка: поле промокода над клавиатурой')
  if (c.mobile && (c.id === 'kit-390' || c.id === 'kit-320')) {
    await page.evaluate((px) => {
      const k = document.createElement('div') // клавиатура на скриншоте — серая плашка
      k.id = 'kb-shot'
      Object.assign(k.style, { position: 'fixed', left: 0, right: 0, bottom: 0, height: `${px}px`, background: '#3a3a40', zIndex: 2147483647 })
      document.documentElement.append(k)
    }, kb.text)
    const file = `${c.id}-keyboard-sheet.png`
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name: `шторка над клавиатурой ${kb.text} px`, file })
    await page.evaluate(() => document.getElementById('kb-shot')?.remove())
  }
  await page.keyboard.press('Enter') // пусто — ошибка
  await settle()
  w = await where(`${field('sheet-promo')} .ui-field__error`, kb.text)
  const errText = await page.locator(`${field('sheet-promo')} .ui-field__error`).textContent()
  expect(errText === 'Введи промокод' && w.fieldBottom <= w.visibleBottom - 4, 'ошибка под полем появилась и тоже над клавиатурой')
  const aria = await page.evaluate((sel) => {
    const i = document.querySelector(`${sel} input`)
    return { invalid: i.getAttribute('aria-invalid'), desc: document.getElementById(i.getAttribute('aria-describedby') ?? '')?.textContent }
  }, field('sheet-promo'))
  expect(aria.invalid === 'true' && aria.desc === 'Введи промокод', 'ошибка: aria-invalid, скринридер читает текст ошибки')
  await page.keyboard.type('vesna')
  expect((await page.locator(`${field('sheet-promo')} .ui-field__error`).textContent()) === '', 'начали исправлять — ошибка ушла')
  await page.keyboard.press('Enter')
  await settle()
  expect(/VESNA отправлен из шторки/.test(await page.locator('[data-live="field"]').textContent()) && (await page.locator('.layer:not([data-closing])').count()) === 0, 'шторка: Enter применяет промокод и закрывает шторку')
  await page.evaluate(() => window.__kb.close())
  await settle()

  // 7. Android: клавиатура ужимает сам экран (interactive-widget=resizes-content)
  {
    await page.evaluate(() => {
      const z = document.querySelector('.app-content')
      z.scrollTop = z.scrollHeight
    })
    await page.locator(`${field('promo')} input`).focus()
    await page.setViewportSize({ width: c.width, height: H - kb.text })
    await settle()
    const a = await page.evaluate(
      ({ sel, h }) => {
        const f = document.querySelector('.app-shell')
        const r = document.querySelector(sel).getBoundingClientRect()
        return { bottom: r.bottom, top: r.top, zoneTop: document.querySelector('.app-header').getBoundingClientRect().bottom, frame: f.getBoundingClientRect().bottom, keyboard: f.dataset.keyboard ?? '', h }
      },
      { sel: field('promo'), h: H - kb.text },
    )
    expect(Math.abs(a.frame - a.h) <= 1 && a.top >= a.zoneTop - 1 && a.bottom <= a.h - 8 && a.keyboard === 'open', 'Android (экран ужался): поле над клавиатурой, таббар спрятан')
    await page.evaluate(() => document.activeElement?.blur())
    await page.setViewportSize({ width: c.width, height: H })
    await settle()
  }
  await page.evaluate(() => document.querySelector('.kb-test-tab')?.remove())
}

/**
 * Шторка и диалог на стенде: открываются стеком overlay.ts, закрываются «Назад» Telegram (в режиме Telegram)
 * или Esc (браузер), фоном, крестиком, жестом вниз; вложенность, двойной тап, фокус, inert, длинная шторка.
 */
async function checkOverlays(page, c, expect, res) {
  const tg = c.mode === 'telegram'
  const backWay = tg ? 'back' : 'esc'
  const backName = tg ? '«Назад» Telegram' : 'Esc'
  const settle = () => page.waitForTimeout(350)
  const opener = (id) => page.locator(`[data-live-box="overlay"] [data-open="${id}"]`)
  const readout = page.locator('[data-live="overlay"]')
  const open = async (id) => {
    await opener(id).scrollIntoViewIfNeeded()
    await opener(id).click()
    await settle()
  }
  const back = async () => {
    if (tg) await page.evaluate(() => window.__check.pressBack())
    else await page.keyboard.press('Escape')
    await settle()
  }
  const shot = async (name, file) => {
    await page.screenshot({ path: join(OUT, file) })
    res.shots.push({ name, file })
  }
  /** Открытые слои снизу вверх (закрывающиеся — ещё на экране, но уже не в счёт) */
  const layers = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.layer')].filter((l) => !('closing' in l.dataset)).map((l) => (l.classList.contains('layer--dialog') ? 'dialog' : 'sheet')).join(','),
    )
  const info = () =>
    page.evaluate(() => {
      const open = [...document.querySelectorAll('.layer')].filter((l) => !('closing' in l.dataset))
      const top = open[open.length - 1]
      const box = top?.querySelector('[role="dialog"], [role="alertdialog"]')
      const title = box && document.getElementById(box.getAttribute('aria-labelledby') ?? '')
      const a = document.activeElement
      const f = document.querySelector('.app-shell').getBoundingClientRect()
      const r = box?.getBoundingClientRect()
      return {
        role: box?.getAttribute('role') ?? '',
        modal: box?.getAttribute('aria-modal') === 'true',
        label: title?.textContent ?? '',
        focusInside: !!top && top.contains(a),
        focusOpen: a?.dataset?.open ?? '',
        focusText: (a?.textContent ?? '').trim(),
        contentInert: document.querySelector('.app-content').inert,
        headerInert: document.querySelector('.app-header').inert,
        lowerInert: open.length > 1 && open.slice(0, -1).every((l) => l.inert),
        inFrame: !!r && r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1,
        atBottom: !!r && Math.abs(r.bottom - f.bottom) <= 1,
        backVisible: window.__check ? window.__check.backVisible() : null,
      }
    })
  const said = async () => (await readout.textContent()) ?? ''

  // Шторка: открыть — фокус внутри, экран под ней недоступен; «Назад» / Esc — закрыть, фокус вернуть
  await open('menu')
  let st = await info()
  expect((await layers()) === 'sheet' && st.role === 'dialog' && st.modal && st.label === 'Намертво', 'шторка: открылась, role="dialog", подпись — заголовок')
  expect(st.inFrame && st.atBottom, 'шторка: внутри кадра, прижата к низу')
  expect(st.focusInside, 'шторка: фокус внутри')
  expect(st.contentInert && st.headerInert, 'шторка: экран под ней недоступен (inert) — ни тапа, ни Tab, ни скринридера')
  if (tg) expect(st.backVisible === true, 'Telegram: при открытой шторке видна системная «Назад»')
  if (c.mobile) await shot('шторка', `${c.id}-sheet.png`)
  await back()
  st = await info()
  expect((await layers()) === '' && (await said()).endsWith(`(${backWay})`), `${backName} закрывает шторку`)
  expect(st.focusOpen === 'menu', 'фокус вернулся на кнопку, открывшую шторку')
  expect(!st.contentInert && !st.headerInert, 'после закрытия экран снова доступен')
  if (tg) expect(st.backVisible === false, 'Telegram: «Назад» скрыта, когда слоёв нет')

  // Диалог поверх шторки: «Назад» закрывает сначала диалог, потом шторку
  await open('menu')
  await page.locator('.layer [data-open="nested"]').click()
  await settle()
  st = await info()
  expect((await layers()) === 'sheet,dialog' && st.role === 'alertdialog' && st.lowerInert, 'диалог поверх шторки: role="alertdialog", шторка под ним недоступна')
  expect(st.focusText === 'Отмена', 'диалог: фокус на «Отмена» — лишний Enter ничего не сломает')
  if (c.mobile) await shot('диалог поверх шторки', `${c.id}-dialog.png`)
  await back()
  st = await info()
  expect((await layers()) === 'sheet' && (await said()) === 'Диалог: не подтвердили', `${backName} закрывает сначала диалог — ответ «нет», шторка остаётся`)
  expect(st.focusOpen === 'nested', 'фокус вернулся на кнопку, открывшую диалог')
  await back()
  expect((await layers()) === '', `второй раз ${backName} закрывает шторку`)

  // Двойной тап по «Отмена» не закрывает шторку под диалогом; крестик закрывает шторку
  await open('menu')
  await page.locator('.layer [data-open="nested"]').click()
  await settle()
  await page.locator('.layer--dialog .btn--secondary').dblclick()
  await settle()
  expect((await layers()) === 'sheet', 'двойной тап по «Отмена» не закрывает шторку под диалогом')
  await page.locator('.layer--sheet .ui-sheet__head .ui-iconbtn').click()
  await settle()
  expect((await layers()) === '' && (await said()).endsWith('(button)'), 'крестик закрывает шторку')

  // Двойной тап по кнопке шторки: закрывающаяся шторка глотает второй тап — действие срабатывает один раз
  await open('menu')
  await page.locator('.layer [data-open="to-story"]').dblclick()
  await settle()
  expect((await layers()) === '' && (await said()) === '«К истории» сработала: 1', 'двойной тап по кнопке шторки срабатывает один раз')

  // Тап по фону над шторкой
  await open('menu')
  const frame = await page.evaluate(() => {
    const f = document.querySelector('.app-shell').getBoundingClientRect()
    return { x: f.left + f.width / 2, y: f.top + 30 }
  })
  await page.mouse.click(frame.x, frame.y)
  await settle()
  expect((await layers()) === '' && (await said()).endsWith('(scrim)'), 'тап по фону закрывает шторку')

  // Жест вниз за шапку: немного — шторка возвращается, дальше четверти — закрывается
  await open('menu')
  const grip = await page.evaluate(() => {
    const r = document.querySelector('.layer .ui-sheet__grip').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x, grip.y + 24, { steps: 4 })
  await page.mouse.up()
  await settle()
  const snapped = await page.evaluate(() => {
    const sheet = document.querySelector('.layer .ui-sheet')
    const tf = getComputedStyle(sheet).transform
    return !sheet.style.getPropertyValue('--ui-sheet-drag') && (tf === 'none' || tf === 'matrix(1, 0, 0, 1, 0, 0)')
  })
  expect((await layers()) === 'sheet' && snapped, 'жест: потянули немного — шторка вернулась на место')
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x, grip.y + 320, { steps: 10 })
  await page.mouse.up()
  await settle()
  expect((await layers()) === '' && (await said()).endsWith('(swipe)'), 'жест вниз закрывает шторку')

  // Шторка без крестика
  await open('plain')
  expect((await page.locator('.layer .ui-sheet .ui-iconbtn').count()) === 0, 'шторка без крестика: крестика нет')
  await back()
  expect((await layers()) === '', `шторку без крестика закрывает ${backName}`)

  // Диалог: обещание да / нет
  await open('dialog')
  expect((await info()).focusText === 'Отмена', 'диалог: фокус на «Отмена»')
  await page.locator('.layer--dialog .btn--primary').click()
  await settle()
  expect((await layers()) === '' && (await said()) === 'Диалог: подтвердили', 'диалог: действие — «да»')
  await open('danger')
  expect((await page.locator('.layer--dialog .btn--danger').count()) === 1, 'опасный диалог: красная кнопка действия')
  await back()
  expect((await layers()) === '' && (await said()) === 'Диалог: не подтвердили', `диалог: ${backName} — «нет»`)
  await open('dialog')
  await page.mouse.click(frame.x, frame.y)
  await settle()
  expect((await layers()) === '' && (await said()) === 'Диалог: не подтвердили', 'диалог: тап по фону — «нет»')

  // Длинная шторка: не выше кадра, шапка на месте, тело прокручивается до последней строки
  await open('long')
  const long = await page.evaluate(() => {
    const f = document.querySelector('.app-shell').getBoundingClientRect()
    const sheet = document.querySelector('.layer .ui-sheet')
    const body = sheet.querySelector('.ui-sheet__body')
    const title = sheet.querySelector('.ui-sheet__title')
    const s = sheet.getBoundingClientRect()
    const titleTop = title.getBoundingClientRect().top
    const scrollable = body.scrollHeight > body.clientHeight + 1
    body.scrollTop = body.scrollHeight
    const last = sheet.querySelector('[data-row-n="24"]').getBoundingClientRect()
    return {
      fits: s.top >= f.top + 24 - 1 && s.bottom <= f.bottom + 1,
      scrollable,
      headStays: Math.abs(title.getBoundingClientRect().top - titleTop) < 1,
      lastVisible: last.bottom <= body.getBoundingClientRect().bottom + 1,
    }
  })
  expect(long.fits, 'длинная шторка: не выше кадра, сверху остаётся полоска фона')
  expect(long.scrollable && long.headStays && long.lastVisible, 'длинная шторка: тело прокручивается до конца, шапка на месте')
  if (c.id === 'kit-320') await shot('длинная шторка', `${c.id}-long.png`)
  await back()

  // Клавиатура (десктоп): Enter открывает, Tab ходит только внутри шторки, Esc закрывает
  if (!c.mobile) {
    await opener('menu').focus()
    await page.keyboard.press('Enter')
    await settle()
    let inside = true
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      // после последней кнопки фокус уходит в интерфейс браузера (здесь — body) и возвращается в шторку, но не на экран под ней
      inside &&= await page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest('.layer:not([data-closing])'))
    }
    expect((await layers()) === 'sheet' && inside, 'клавиатура: Enter открывает шторку, Tab не уходит на экран под ней')
    await page.keyboard.press('Escape')
    await settle()
    st = await info()
    expect((await layers()) === '' && st.focusOpen === 'menu', 'клавиатура: Esc закрывает, фокус — обратно на кнопку')
  }
}

/** Цвет из computed-строки или hex — в «r,g,b» для сравнения */
function parseColorNode(s) {
  const hex = s.match(/^#([0-9a-f]{6})$/i)
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).join(',')
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/)
  return m ? [m[1], m[2], m[3]].map(Number).join(',') : s
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
    if (selected('stats')) {
      try { await checkStatsUi(browser, OUT) } catch (error) { global.errors.push(`stats: ${error.stack}`) }
    }
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
    const kitCases = KIT_CASES.filter((c) => selected(c.id))
    if (kitCases.length) {
      // Стенд компонентов тоже только в dev — свой dev-сервер Vite
      const kit = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 5181, strictPort: false, hmr: false } })
      await kit.listen()
      const kitUrl = `${kit.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5181/'}kit.html`
      try {
        for (const c of kitCases) logResult(await runKitCase(browser, kitUrl, c))
      } finally {
        await kit.close()
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
