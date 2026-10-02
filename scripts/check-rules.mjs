/**
 * Автопроверка правил — `npm run check:rules` (первый шаг `npm run check:ui`)
 *
 * Без браузера и сборки, ~1 с. Превращает правила CLAUDE.md в проверки, чтобы их нельзя было
 * нарушить молча — ни ИИ-агенту, ни человеку:
 *   код        — сеть только через api.ts, Telegram только через telegram.ts, хранилище, HTML-строки
 *                в DOM, системные диалоги, window.open, компоненты без сети, заглушки (правила 2, 5, 7, 15)
 *   CSS        — !important, z-index токенами, @media по окну, cqh с запасным vh, цвета через переменные,
 *                глобальные селекторы, префикс ui- в kit, :root только в style.css (правило 4)
 *   зависимости — runtime нет, dev — только разрешённые (правило 8)
 *   контент    — каталог (инвариант H3) и граф каждой главы (CLAUDE.md, «Игровая модель»)
 *   публикация — сверка с прод-версией origin/main: id выборов и историй на месте, id экранов — замечание
 *   самопроверка — каждое правило ловит своё нарушение на образце и не срабатывает на допустимом коде:
 *                правило нельзя тихо «выключить», чтобы проверка стала зелёной
 *
 * ✗ ошибка — код выхода 1. ! замечание — не блокирует, новые перечисляются в отчёте шага.
 * Списки исключений (ALLOW) расширяются только решением владельца (CLAUDE.md, правило 14).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const ROOT = resolve('.')
const rel = (p) => relative(ROOT, p).split(sep).join('/')

/** Исключения из правил. Расширять — только с решением владельца (правило 14) */
const ALLOW = {
  fetch: ['src/api.ts', 'src/engine.ts', 'src/analytics.ts'],
  beacon: ['src/analytics.ts'],
  webStorage: ['src/storage.ts', 'src/analytics.ts'],
  cloudStorage: ['src/storage.ts', 'src/telegram.ts'],
  telegramGlobal: ['src/telegram.ts'],
  // stats-login — админ-страница входа в статистику вне игры: свой переход после входа и своя светлая палитра
  openLink: ['src/telegram.ts', 'src/stats-login.ts'],
  ownPalette: ['src/stats-login.css'],
  windowMedia: ['src/layout/shell.css'],
  devDependencies: ['typescript', 'vite', 'playwright-core'],
}

const CHOICE_TYPES = ['moral', 'romance', 'neutral']
const SCENE_KINDS = ['text', 'push', 'end']

// ---------------------------------------------------------------------------
// Общее
// ---------------------------------------------------------------------------

/** Находка: level — error (✗) или warn (!); rule — ссылка на CLAUDE.md; fix — что сделать вместо */
const finding = (level, id, rule, where, msg, fix) => ({ level, id, rule, where, msg, fix })

/** Номер строки по смещению в тексте */
function lineIndex(text) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1)
  return (offset) => {
    let lo = 0
    let hi = starts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (starts[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo + 1
  }
}

function walk(dir, test, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, test, out)
    else if (test(full)) out.push(full)
  }
  return out
}

/** Код без комментариев: строки и шаблоны остаются, переносы строк сохраняются — для номеров строк */
export function stripJsComments(src) {
  let out = ''
  let mode = 'code' // code | line | block | ' | " | `
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    const n = src[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') {
        mode = 'line'
        out += '  '
        i++
        continue
      }
      if (c === '/' && n === '*') {
        mode = 'block'
        out += '  '
        i++
        continue
      }
      if (c === "'" || c === '"' || c === '`') mode = c
      out += c
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code'
        out += c
      } else out += ' '
    } else if (mode === 'block') {
      if (c === '*' && n === '/') {
        mode = 'code'
        out += '  '
        i++
      } else out += c === '\n' ? c : ' '
    } else {
      if (c === '\\') {
        out += c + (n ?? '')
        i++
        continue
      }
      if (c === mode) mode = 'code'
      out += c
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Код: src/**/*.ts
// ---------------------------------------------------------------------------

const CODE_RULES = [
  {
    id: 'net-fetch',
    rule: 'правило 5',
    re: /\bfetch\s*\(/g,
    allow: ALLOW.fetch,
    msg: 'сеть мимо api.ts',
    fix: 'запрос — функция в src/api.ts (тип ответа + мок), данные — через sync.ts → store',
  },
  {
    id: 'net-beacon',
    rule: 'правило 5',
    re: /\bsendBeacon\s*\(/g,
    allow: ALLOW.beacon,
    msg: 'sendBeacon мимо analytics.ts',
    fix: 'события — track() из src/analytics.ts',
  },
  {
    id: 'net-other',
    rule: 'правило 5',
    re: /\b(XMLHttpRequest|WebSocket|EventSource)\b/g,
    allow: [],
    msg: 'сетевой канал мимо api.ts',
    fix: 'новый канал — сначала тип и мок в src/api.ts, решение владельца',
  },
  {
    id: 'telegram-global',
    rule: 'инвариант «Telegram API»',
    re: /\bwindow\.Telegram\b|\bTelegram\??\.WebApp\b/g,
    allow: ALLOW.telegramGlobal,
    msg: 'Telegram WebApp мимо telegram.ts',
    fix: 'функция-обёртка в src/telegram.ts с проверкой supports()',
  },
  {
    id: 'web-storage',
    rule: 'правило 7',
    re: /\b(localStorage|sessionStorage|indexedDB)\b/g,
    allow: ALLOW.webStorage,
    msg: 'хранилище браузера мимо storage.ts',
    fix: 'сохранение — только src/storage.ts, и только отдельной задачей',
  },
  {
    id: 'cloud-storage',
    rule: 'правило 7',
    re: /\bCloudStorage\b/g,
    allow: ALLOW.cloudStorage,
    msg: 'CloudStorage мимо storage.ts',
    fix: 'сохранение — только src/storage.ts, и только отдельной задачей',
  },
  {
    id: 'dom-html',
    rule: 'правило 15',
    re: /\.(innerHTML|outerHTML)\s*\+?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(ln)?\s*\(/g,
    allow: [],
    msg: 'HTML-строкой в DOM (тексты глав и сервера попадут в разметку)',
    fix: 'h(тег, { text }) и icon() из src/ui/dom.ts',
  },
  {
    id: 'sys-dialog',
    rule: 'правило 15',
    re: /(?<![\w.$])(alert|confirm|prompt)\s*\(|\bwindow\.(alert|confirm|prompt)\s*\(/g,
    allow: [],
    msg: 'системный диалог браузера (в Telegram блокирует WebView)',
    fix: 'confirmAction() / toast() из src/ui/overlay.ts',
  },
  {
    id: 'open-link',
    rule: 'правило 15',
    re: /\bwindow\.open\s*\(|\blocation\.(assign|replace)\s*\(|\blocation\.href\s*=(?!=)/g,
    allow: ALLOW.openLink,
    msg: 'переход по ссылке мимо telegram.ts',
    fix: 'обёртка в src/telegram.ts (openLink / openTelegramLink с supports())',
  },
  {
    id: 'ui-network',
    rule: 'правило 5',
    only: /^src\/(ui|layout)\//,
    re: /^\s*import\s+(?!type\b)[^;]*?from\s+['"](?:\.\.\/)+(?:api|sync)['"]/gm,
    allow: [],
    msg: 'экран или компонент импортирует сеть',
    fix: 'компонент читает store (store.select); сеть — api.ts → sync.ts → store',
  },
]

export function checkCodeFile(path, text) {
  const out = []
  const code = stripJsComments(text)
  const line = lineIndex(code)
  for (const r of CODE_RULES) {
    if (r.only && !r.only.test(path)) continue
    if (r.allow.includes(path)) continue
    for (const m of code.matchAll(r.re)) {
      out.push(finding('error', r.id, r.rule, `${path}:${line(m.index)}`, `${r.msg}: ${m[0].trim()}`, r.fix))
    }
  }
  return out
}

/** Правило 2: заглушки вместо кода */
const STUB_RES = [
  /\/\/\s*(\.{3}|…)\s*$/gm,
  /\/\*\s*(\.{3}|…)\s*\*\//g,
  /(код|функци[яи]|остальное|остальной код)\s+(без изменений|как было)/gi, // без \b: в JS он не видит кириллицу
  /\b(rest of|remaining) (the )?(code|file|implementation)\b/gi,
  /\b(existing|unchanged) code\b/gi,
]

export function checkStubs(path, text) {
  const out = []
  const line = lineIndex(text)
  for (const re of STUB_RES) {
    for (const m of text.matchAll(re)) {
      out.push(
        finding('error', 'stub', 'правило 2', `${path}:${line(m.index)}`, `заглушка вместо кода: «${m[0].trim()}»`, 'написать код полностью; файл целиком — только новый'),
      )
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

/** Разбор CSS: правила с селектором, at-правилами вокруг и объявлениями по порядку */
export function parseCss(src) {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  const line = lineIndex(text)
  const rules = []
  const atRules = []
  const stack = []
  let buf = ''
  let bufStart = 0
  const trimmedStart = () => bufStart + (buf.length - buf.trimStart().length)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '{') {
      const prelude = buf.trim()
      const at = prelude.startsWith('@')
      const inKeyframes = stack.some((f) => /^@(-webkit-)?keyframes\b/.test(f.prelude))
      const frame = { prelude, at }
      if (at) atRules.push({ prelude, line: line(trimmedStart()) })
      else if (!inKeyframes) {
        frame.rule = { selector: prelude, line: line(trimmedStart()), at: stack.filter((f) => f.at).map((f) => f.prelude), decls: [] }
        rules.push(frame.rule)
      }
      stack.push(frame)
      buf = ''
      bufStart = i + 1
    } else if (c === ';' || c === '}') {
      const d = buf.trim()
      const top = stack[stack.length - 1]
      if (d && top?.rule) {
        const k = d.indexOf(':')
        if (k > 0) top.rule.decls.push({ prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim(), line: line(trimmedStart()) })
      }
      if (c === '}') stack.pop()
      buf = ''
      bufStart = i + 1
    } else buf += c
  }
  return { rules, atRules }
}

/** Список селекторов через запятую — без запятых внутри :is() / :not() */
function splitSelectors(list) {
  const out = []
  let depth = 0
  let cur = ''
  for (const c of list) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const WINDOW_MEDIA = /\b((min|max)-)?(device-)?(width|height|aspect-ratio)\b|\borientation\b/
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(/i
/** Чёрная тень — допустимый нейтральный цвет */
const BLACK_SHADOW = /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*(,\s*[\d.]+\s*)?\)|rgba?\(\s*0\s+0\s+0\s*(\/\s*[\d.%]+\s*)?\)/gi

export function checkCssFile(path, text) {
  const out = []
  const { rules, atRules } = parseCss(text)
  const legacy = path === 'src/style.css'
  const stand = /\/preview\.css$/.test(path)
  const component = !legacy && !stand
  const kit = /^src\/ui\/kit\/[^/]+\.css$/.test(path) && !stand
  const at = (l) => `${path}:${l}`

  for (const a of atRules) {
    if (/^@media\b/.test(a.prelude) && WINDOW_MEDIA.test(a.prelude) && !ALLOW.windowMedia.includes(path)) {
      out.push(
        finding('error', 'css-window-media', 'правило 4', at(a.line), `@media по размеру окна: ${a.prelude}`, 'внутри кадра — @container app (…); по окну — только сам кадр в shell.css'),
      )
    }
  }

  for (const r of rules) {
    const selectors = splitSelectors(r.selector)
    if (selectors.includes(':root') && !legacy) {
      out.push(finding('error', 'css-root', 'правило 4', at(r.line), ':root вне style.css', 'токен — в :root src/style.css по запросу владельца'))
    }
    if (component) {
      for (const s of selectors) {
        if (!s.includes('.')) {
          out.push(finding('error', 'css-global', 'правило 4', at(r.line), `глобальный или теговый селектор: ${s}`, 'только классы компонента с префиксом'))
        } else if (kit && !/\.ui-/.test(s)) {
          out.push(finding('error', 'css-prefix', 'правило 4', at(r.line), `селектор без класса ui-: ${s}`, 'стили kit — только на классах ui-*'))
        }
      }
    }

    r.decls.forEach((d, i) => {
      if (/!important/i.test(d.value) && !r.at.some((p) => /prefers-reduced-motion/.test(p))) {
        out.push(finding('error', 'css-important', 'правило 4', at(d.line), `!important: ${d.prop}`, 'поднять специфичность или порядок правил; !important — только в @media (prefers-reduced-motion)'))
      }
      if (d.prop === 'z-index' && !/^(var\(--z-[a-z-]+\)|auto)$/.test(d.value)) {
        out.push(finding('error', 'css-z-index', 'правило 4', at(d.line), `z-index числом: ${d.value}`, 'токен var(--z-*) из :root; новый слой — новый токен в шкале'))
      }
      if (d.prop.startsWith('--z-') && !(legacy && selectors.includes(':root'))) {
        out.push(finding('error', 'css-z-token', 'правило 4', at(d.line), `токен слоя вне шкалы: ${d.prop}`, 'шкала --z-* — только в :root src/style.css'))
      }
      if (/\d(\.\d+)?cqh\b/.test(d.value)) {
        const prev = r.decls[i - 1]
        if (!prev || prev.prop !== d.prop || !/\d(\.\d+)?d?vh\b/.test(prev.value)) {
          out.push(finding('error', 'css-cqh', 'правило 4', at(d.line), `${d.prop} в cqh без запасной строки в vh`, `строкой выше — ${d.prop} с vh для старых WebView`))
        }
      }
      if (component && !ALLOW.ownPalette.includes(path) && COLOR_LITERAL.test(d.value.replace(BLACK_SHADOW, ''))) {
        out.push(finding('error', 'css-color', 'правило 4', at(d.line), `цвет мимо переменных: ${d.prop}: ${d.value}`, 'цвета — var(--…) палитры; смесь — color-mix() внутри @supports'))
      }
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Зависимости
// ---------------------------------------------------------------------------

export function checkPackage(pkg) {
  const out = []
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const names = Object.keys(pkg[field] ?? {})
    if (names.length) {
      out.push(finding('error', 'deps-runtime', 'правило 8', `package.json → ${field}`, `зависимости: ${names.join(', ')}`, 'runtime-зависимостей нет — только с согласия владельца'))
    }
  }
  const extra = Object.keys(pkg.devDependencies ?? {}).filter((n) => !ALLOW.devDependencies.includes(n))
  if (extra.length) {
    out.push(finding('error', 'deps-dev', 'правило 8', 'package.json → devDependencies', `новые: ${extra.join(', ')}`, 'новая зависимость — только с согласия владельца'))
  }
  return out
}

// ---------------------------------------------------------------------------
// Контент: каталог и главы (public/content/<язык>/)
// ---------------------------------------------------------------------------

/** Строка в JSON-файле, где впервые встречается фрагмент — для ссылки в находке */
function jsonLine(raw, needle) {
  const i = raw.indexOf(needle)
  return i < 0 ? 1 : raw.slice(0, i).split('\n').length
}

export function checkCatalog(lang, catalog, raw, fileExists) {
  const out = []
  const where = (needle) => `public/content/${lang}/catalog.json:${jsonLine(raw, needle)}`
  if (catalog.firstLaunch !== 'story') {
    out.push(
      finding('error', 'h3-first-launch', 'инвариант H3', where('firstLaunch'), `firstLaunch: ${JSON.stringify(catalog.firstLaunch)}`, 'первый запуск — сразу эпизод 1 ("story"); менять — только решением владельца'),
    )
  }
  const stories = Array.isArray(catalog.stories) ? catalog.stories : []
  if (!stories.some((s) => s.id === catalog.defaultStory)) {
    out.push(finding('error', 'catalog-default', 'игровая модель', where('defaultStory'), `defaultStory «${catalog.defaultStory}» нет в stories`, 'id существующей истории'))
  }
  const seen = new Set()
  for (const s of stories) {
    const w = where(`"id": "${s.id}"`)
    if (seen.has(s.id)) out.push(finding('error', 'catalog-story-id', 'игровая модель', w, `история «${s.id}» повторяется`, 'id историй уникальны'))
    seen.add(s.id)
    if (!/^[a-z0-9_-]+$/.test(String(s.id))) out.push(finding('warn', 'catalog-story-id-format', 'игровая модель', w, `id истории «${s.id}» — не латиница a-z, 0-9, _ -`, 'id попадает в аналитику и сохранения'))
    const eps = Array.isArray(s.episodes) ? s.episodes : []
    eps.forEach((e, i) => {
      if (e.n !== i + 1) out.push(finding('error', 'catalog-episode-n', 'игровая модель', w, `«${s.id}»: эпизод на месте ${i + 1} имеет n = ${e.n}`, 'эпизоды нумеруются 1, 2, 3… по порядку'))
      if (e.status === 'available' && !e.file) out.push(finding('error', 'catalog-episode-file', 'игровая модель', w, `«${s.id}»: эпизод ${e.n} доступен, но без файла`, 'file: "chN.json" или status: "soon"'))
      if (e.file && !fileExists(e.file)) out.push(finding('error', 'catalog-episode-file', 'игровая модель', w, `«${s.id}»: файла ${e.file} нет`, `положить public/content/${lang}/${e.file} или убрать file`))
    })
    if (s.status === 'available' && !eps.some((e) => e.status === 'available')) {
      out.push(finding('error', 'catalog-story-empty', 'игровая модель', w, `«${s.id}» доступна, но в ней нет доступных эпизодов`, 'status: "soon" или выпустить эпизод'))
    }
  }
  return out
}

/** Граф главы. Возвращает находки, id выборов и экранов (для сверки по истории и с прод-версией) */
export function checkChapter(lang, file, chapter, raw, assetExists) {
  const out = []
  const path = `public/content/${lang}/${file}`
  const where = (needle) => `${path}:${jsonLine(raw, needle)}`
  const scenes = chapter && typeof chapter.scenes === 'object' && chapter.scenes ? chapter.scenes : {}
  const ids = Object.keys(scenes)
  const choiceIds = []
  const stats = { scenes: ids.length, choices: 0 }

  if (typeof chapter?.title !== 'string' || !chapter.title.trim()) out.push(finding('error', 'chapter-title', 'игровая модель', path, 'нет title', 'название эпизода строкой'))
  if (!scenes[chapter?.startScene]) out.push(finding('error', 'chapter-start', 'игровая модель', where('startScene'), `startScene «${chapter?.startScene}» нет среди экранов`, 'id существующего экрана'))

  const edges = new Map()
  for (const [id, s] of Object.entries(scenes)) {
    const w = where(`"${id}"`)
    const kind = s.kind ?? 'text'
    const targets = []
    edges.set(id, targets)
    if (!SCENE_KINDS.includes(kind)) out.push(finding('error', 'scene-kind', 'инвариант «Глава»', w, `экран ${id}: kind «${kind}»`, `kind — ${SCENE_KINDS.join(' | ')}`))
    if (typeof s.text !== 'string' || !s.text.trim()) out.push(finding('error', 'scene-text', 'игровая модель', w, `экран ${id}: пустой text`, 'текст экрана — автор'))
    const hasNext = s.next !== undefined
    const hasChoices = s.choices !== undefined
    if (kind === 'end' && (hasNext || hasChoices)) out.push(finding('error', 'scene-end', 'инвариант «Глава»', w, `экран ${id}: конец эпизода с переходом дальше`, 'у end нет ни next, ни choices'))
    if (kind !== 'end' && hasNext === hasChoices) {
      out.push(finding('error', 'scene-next-choices', 'инвариант «Глава»', w, `экран ${id}: ${hasNext ? 'и next, и choices' : 'ни next, ни choices'}`, 'у экрана либо next, либо choices'))
    }
    if (hasNext) {
      targets.push(s.next)
      if (!scenes[s.next]) out.push(finding('error', 'scene-link', 'игровая модель', w, `экран ${id}: next → «${s.next}» не существует`, 'ссылка на существующий экран'))
    }
    if (s.image !== undefined) {
      if (/^https?:/i.test(s.image)) out.push(finding('warn', 'scene-image-external', 'игровая модель', w, `экран ${id}: картинка с чужого адреса`, 'картинки — в public/: быстрее и без внешних запросов'))
      else if (!assetExists(s.image)) out.push(finding('error', 'scene-image', 'игровая модель', w, `экран ${id}: картинки ${s.image} нет в public/`, 'положить файл или поправить путь'))
    }
    if (!hasChoices) continue
    if (!Array.isArray(s.choices) || s.choices.length === 0) {
      out.push(finding('error', 'choice-empty', 'игровая модель', w, `экран ${id}: пустой список выборов`, 'не меньше двух вариантов'))
      continue
    }
    if (s.choices.length === 1) out.push(finding('warn', 'choice-single', 'игровая модель', w, `экран ${id}: выбор из одного варианта`, 'развилка — от двух вариантов, иначе next'))
    let free = 0
    for (const c of s.choices) {
      stats.choices++
      const cw = where(`"${c.id}"`)
      choiceIds.push(c.id)
      targets.push(c.next)
      const type = c.type ?? 'neutral'
      if (typeof c.id !== 'string' || !c.id) out.push(finding('error', 'choice-id', 'инвариант «Глава»', w, `экран ${id}: выбор без id`, 'постоянный id выбора'))
      else if (!/^[a-z0-9_]+$/.test(c.id)) out.push(finding('warn', 'choice-id-format', 'игровая модель', cw, `id выбора «${c.id}» — не a-z, 0-9, _`, 'id уходит в аналитику: e1_c2_accept'))
      if (typeof c.text !== 'string' || !c.text.trim()) out.push(finding('error', 'choice-text', 'игровая модель', cw, `выбор ${c.id}: пустой text`, 'текст кнопки — автор'))
      if (!scenes[c.next]) out.push(finding('error', 'scene-link', 'игровая модель', cw, `выбор ${c.id}: next → «${c.next}» не существует`, 'ссылка на существующий экран'))
      if (!CHOICE_TYPES.includes(type)) out.push(finding('error', 'choice-type', 'игровая модель', cw, `выбор ${c.id}: type «${type}»`, `type — ${CHOICE_TYPES.join(' | ')}`))
      if (c.price !== undefined && !(Number.isInteger(c.price) && c.price > 0)) {
        out.push(finding('error', 'choice-price', 'игровая модель', cw, `выбор ${c.id}: price ${JSON.stringify(c.price)}`, 'цена — целое больше нуля или поля нет'))
      }
      if (type === 'moral' && c.price !== undefined) {
        out.push(finding('error', 'choice-moral-paid', 'инвариант «Моральный выбор бесплатный»', cw, `выбор ${c.id}: моральный выбор с ценой`, 'моральная развилка всегда бесплатная (src/types.ts)'))
      }
      if (c.price === undefined) free++
      for (const [k, v] of Object.entries(c.effects ?? {})) {
        if (!Number.isInteger(v)) out.push(finding('error', 'choice-effects', 'игровая модель', cw, `выбор ${c.id}: счётчик ${k} = ${JSON.stringify(v)}`, 'изменение счётчика — целое число'))
        if (!/^[a-z0-9_]+$/.test(k)) out.push(finding('warn', 'choice-effects-name', 'игровая модель', cw, `выбор ${c.id}: имя счётчика «${k}»`, 'имена счётчиков — a-z, 0-9, _'))
      }
    }
    if (free === 0) {
      out.push(finding('warn', 'choice-no-free', 'игровая модель', w, `экран ${id}: все варианты платные`, 'бесплатный вариант в каждой развилке — открытый вопрос владельцу'))
    }
  }

  // Достижимость: все экраны — от старта; конец — из каждого достижимого экрана
  const ends = ids.filter((id) => (scenes[id].kind ?? 'text') === 'end')
  if (ids.length && ends.length === 0) out.push(finding('error', 'chapter-no-end', 'игровая модель', path, 'в эпизоде нет экрана kind: "end"', 'эпизод заканчивается карточкой конца'))
  const reach = new Set()
  const queue = scenes[chapter?.startScene] ? [chapter.startScene] : []
  while (queue.length) {
    const id = queue.shift()
    if (reach.has(id) || !scenes[id]) continue
    reach.add(id)
    queue.push(...(edges.get(id) ?? []))
  }
  for (const id of ids) {
    if (!reach.has(id)) out.push(finding('warn', 'scene-unreachable', 'игровая модель', where(`"${id}"`), `экран ${id} недостижим от старта`, 'черновик — убрать или связать'))
  }
  const canEnd = new Set(ends)
  for (let changed = true; changed; ) {
    changed = false
    for (const id of ids) {
      if (!canEnd.has(id) && (edges.get(id) ?? []).some((t) => canEnd.has(t))) {
        canEnd.add(id)
        changed = true
      }
    }
  }
  for (const id of reach) {
    if (!canEnd.has(id)) out.push(finding('error', 'scene-dead-end', 'игровая модель', where(`"${id}"`), `с экрана ${id} не дойти до конца эпизода`, 'тупик или петля без выхода: связать с концом'))
  }
  return { findings: out, choiceIds, sceneIds: ids, stats }
}

/** id выборов уникальны во всей истории: picks в сохранении — на весь сезон */
export function checkStoryChoiceIds(lang, storyId, perFile) {
  const out = []
  const owner = new Map()
  for (const [file, ids] of perFile) {
    for (const id of ids) {
      if (owner.has(id)) {
        out.push(finding('error', 'choice-id-duplicate', 'инвариант «Глава»', `public/content/${lang}/${file}`, `«${storyId}»: id выбора «${id}» повторяется (${owner.get(id)})`, 'id выборов уникальны в пределах истории'))
      } else owner.set(id, file)
    }
  }
  return out
}

/** Сверка с прод-версией: опубликованное не пропадает */
export function checkPublished(lang, file, published, current) {
  const out = []
  const path = `public/content/${lang}/${file}`
  const now = new Set(current.choiceIds)
  for (const id of published.choiceIds) {
    if (!now.has(id)) {
      out.push(finding('error', 'published-choice-id', 'инвариант «Глава»', path, `id выбора «${id}» есть в проде (origin/main), а здесь пропал`, 'id выбора после публикации не меняется: вернуть id, текст — менять можно'))
    }
  }
  const scenes = new Set(current.sceneIds)
  for (const id of published.sceneIds) {
    if (!scenes.has(id)) {
      out.push(
        finding('warn', 'published-scene-id', 'инвариант «Глава»', path, `экран «${id}» есть в проде, а здесь пропал`, 'у игроков на этом экране эпизод начнётся заново, а его счётчики посчитаются дважды — оставить id'),
      )
    }
  }
  return out
}

export function checkPublishedCatalog(lang, published, current) {
  const out = []
  const now = new Set((current.stories ?? []).map((s) => s.id))
  for (const s of published.stories ?? []) {
    if (s.status === 'available' && !now.has(s.id)) {
      out.push(finding('error', 'published-story-id', 'инвариант «Глава»', `public/content/${lang}/catalog.json`, `история «${s.id}» есть в проде, а здесь пропала`, 'id истории — ключ сохранений и аналитики: не менять'))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Прогон по проекту
// ---------------------------------------------------------------------------

function readJson(path) {
  const raw = readFileSync(path, 'utf8')
  return { raw, data: JSON.parse(raw) }
}

/** Файл из прод-ветки origin/main; null — нет ветки или файла */
function fromMain(path) {
  try {
    return execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

function hasMain() {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'origin/main'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function runProject() {
  const sections = []

  // Код
  const tsFiles = walk(resolve('src'), (f) => f.endsWith('.ts'))
  const code = []
  for (const f of tsFiles) code.push(...checkCodeFile(rel(f), readFileSync(f, 'utf8')))
  const stubFiles = [
    ...tsFiles,
    ...walk(resolve('src'), (f) => f.endsWith('.css')),
    ...walk(resolve('scripts'), (f) => /\.(mjs|js|ts)$/.test(f) && !f.endsWith('check-rules.mjs')),
    ...walk(resolve('server'), (f) => /\.(mjs|js)$/.test(f)),
  ]
  for (const f of stubFiles) code.push(...checkStubs(rel(f), readFileSync(f, 'utf8')))
  sections.push({ name: 'код', note: `файлов: ${stubFiles.length}`, findings: code })

  // CSS
  const cssFiles = walk(resolve('src'), (f) => f.endsWith('.css'))
  const css = []
  for (const f of cssFiles) css.push(...checkCssFile(rel(f), readFileSync(f, 'utf8')))
  sections.push({ name: 'CSS', note: `файлов: ${cssFiles.length}`, findings: css })

  // Зависимости
  sections.push({ name: 'зависимости', note: 'package.json', findings: checkPackage(JSON.parse(readFileSync(resolve('package.json'), 'utf8'))) })

  // Контент и публикация
  const main = hasMain()
  const published = []
  let compared = 0
  for (const lang of readdirSync(resolve('public/content')).filter((d) => existsSync(resolve('public/content', d, 'catalog.json')))) {
    const dir = resolve('public/content', lang)
    const content = []
    const { raw, data: catalog } = readJson(join(dir, 'catalog.json'))
    content.push(...checkCatalog(lang, catalog, raw, (file) => existsSync(join(dir, file))))
    let scenes = 0
    let choices = 0
    let chapters = 0
    const referenced = new Set()
    for (const story of catalog.stories ?? []) {
      const perFile = []
      for (const ep of story.episodes ?? []) {
        if (!ep.file || !existsSync(join(dir, ep.file))) continue
        referenced.add(ep.file)
        let chapter
        let chRaw
        try {
          ;({ raw: chRaw, data: chapter } = readJson(join(dir, ep.file)))
        } catch (e) {
          content.push(finding('error', 'chapter-json', 'игровая модель', `public/content/${lang}/${ep.file}`, `JSON не читается: ${e.message}`, 'исправить синтаксис'))
          continue
        }
        const res = checkChapter(lang, ep.file, chapter, chRaw, (p) => existsSync(resolve('public', p.replace(/^\//, ''))))
        content.push(...res.findings)
        perFile.push([ep.file, res.choiceIds])
        scenes += res.stats.scenes
        choices += res.stats.choices
        chapters++
        if (main) {
          const prodRaw = fromMain(`public/content/${lang}/${ep.file}`)
          if (prodRaw) {
            try {
              const prod = checkChapter(lang, ep.file, JSON.parse(prodRaw), prodRaw, () => true)
              published.push(...checkPublished(lang, ep.file, prod, res))
              compared++
            } catch {
              // прод-версия не читается — сверять не с чем
            }
          }
        }
      }
      content.push(...checkStoryChoiceIds(lang, story.id, perFile))
    }
    for (const f of readdirSync(dir).filter((f) => /^ch\d+\.json$/.test(f) && !referenced.has(f))) {
      content.push(finding('warn', 'chapter-orphan', 'игровая модель', `public/content/${lang}/${f}`, 'файл эпизода не указан в каталоге', 'добавить в episodes или убрать'))
    }
    if (main) {
      const prodCatalog = fromMain(`public/content/${lang}/catalog.json`)
      if (prodCatalog) {
        try {
          published.push(...checkPublishedCatalog(lang, JSON.parse(prodCatalog), catalog))
        } catch {
          // прод-версия не читается — сверять не с чем
        }
      }
    }
    sections.push({ name: `контент ${lang}`, note: `эпизодов: ${chapters}, экранов: ${scenes}, выборов: ${choices}`, findings: content })
  }
  sections.push({
    name: 'публикация',
    note: main ? `сверено с origin/main: эпизодов ${compared}` : 'нет origin/main — сверка пропущена (git fetch origin main)',
    findings: published,
  })
  return sections
}

// ---------------------------------------------------------------------------
// Самопроверка: каждое правило ловит своё нарушение и молчит на допустимом
// ---------------------------------------------------------------------------

function selfTest() {
  const okChapter = {
    title: 'Эпизод',
    startScene: 's1',
    scenes: {
      s1: { text: 'a', choices: [{ id: 'c_a', text: 'a', next: 's2', type: 'moral' }, { id: 'c_b', text: 'b', next: 's2', price: 5, type: 'romance' }] },
      s2: { text: 'b', next: 'end' },
      end: { kind: 'end', text: 'конец' },
    },
  }
  const clone = (o) => JSON.parse(JSON.stringify(o))
  const ch = (mut) => {
    const c = clone(okChapter)
    mut(c)
    return checkChapter('ru', 'ch1.json', c, JSON.stringify(c, null, 2), () => false).findings
  }
  const cat = (mut) => {
    const c = { firstLaunch: 'story', defaultStory: 'x', stories: [{ id: 'x', status: 'available', episodes: [{ n: 1, file: 'ch1.json', status: 'available' }] }] }
    mut(c)
    return checkCatalog('ru', c, JSON.stringify(c), (f) => f === 'ch1.json')
  }
  const css = (path, text) => checkCssFile(path, text)
  const ts = (path, text) => checkCodeFile(path, text)
  const pub = (prodMut, curMut) => {
    const a = clone(okChapter)
    const b = clone(okChapter)
    prodMut?.(a)
    curMut?.(b)
    const run = (c) => checkChapter('ru', 'ch1.json', c, '', () => true)
    return checkPublished('ru', 'ch1.json', run(a), run(b))
  }

  /** [ожидаемое правило | null — находок быть не должно, название, находки] */
  const cases = [
    ['net-fetch', 'fetch в экране', ts('src/ui/x.ts', "fetch('/api/wallet')")],
    ['net-beacon', 'sendBeacon вне analytics.ts', ts('src/x.ts', 'navigator.sendBeacon(u, b)')],
    ['net-other', 'WebSocket', ts('src/x.ts', "new WebSocket('wss://x')")],
    ['telegram-global', 'window.Telegram вне telegram.ts', ts('src/ui/x.ts', 'window.Telegram.WebApp.close()')],
    ['web-storage', 'localStorage вне storage.ts', ts('src/ui/x.ts', "localStorage.getItem('k')")],
    ['cloud-storage', 'CloudStorage вне storage.ts', ts('src/ui/x.ts', 'tg.CloudStorage.setItem(k, v)')],
    ['dom-html', 'innerHTML', ts('src/ui/x.ts', 'el.innerHTML = scene.text')],
    ['dom-html', 'insertAdjacentHTML', ts('src/ui/x.ts', "el.insertAdjacentHTML('beforeend', s)")],
    ['sys-dialog', 'confirm()', ts('src/ui/x.ts', "if (confirm('Точно?')) go()")],
    ['sys-dialog', 'window.alert()', ts('src/ui/x.ts', "window.alert('x')")],
    ['open-link', 'window.open', ts('src/ui/x.ts', 'window.open(url)')],
    ['open-link', 'location.href =', ts('src/ui/x.ts', 'location.href = url')],
    ['open-link', 'location.replace в игре', ts('src/ui/x.ts', 'location.replace(url)')],
    [null, 'переход на админ-странице статистики', ts('src/stats-login.ts', 'location.replace(target.href)')],
    ['ui-network', 'экран импортирует api', ts('src/ui/x.ts', "import { getWallet } from '../api'")],
    ['ui-network', 'kit импортирует sync', ts('src/ui/kit/x.ts', "import { refresh } from '../../sync'")],
    ['stub', 'заглушка // ...', checkStubs('src/x.ts', 'function f() {\n  // ...\n}')],
    ['stub', 'остальное как было', checkStubs('src/x.ts', '/* остальное как было */')],
    ['css-important', '!important', css('src/ui/kit/x.css', '.ui-x { color: var(--text) !important; }')],
    ['css-z-index', 'z-index числом', css('src/ui/kit/x.css', '.ui-x { z-index: 5; }')],
    ['css-z-token', 'токен слоя вне :root', css('src/ui/kit/x.css', '.ui-x { --z-new: 7; }')],
    ['css-window-media', '@media по ширине окна', css('src/ui/kit/x.css', '@media (min-width: 600px) { .ui-x { gap: 0; } }')],
    ['css-cqh', 'cqh без vh', css('src/ui/kit/x.css', '.ui-x { max-height: 50cqh; }')],
    ['css-color', 'цвет числом', css('src/ui/kit/x.css', '.ui-x { color: #fff; }')],
    ['css-color', 'своя палитра в игре', css('src/ui/x.css', '.ui-x { --x-bg: #fff; }')],
    [null, 'своя палитра админ-страницы статистики', css('src/stats-login.css', '.stats-login { --stats-bg: #fff; }')],
    ['css-color', 'rgba не чёрный', css('src/layout/x.css', '.app-x { background: rgba(20, 18, 26, 0.5); }')],
    ['css-global', 'теговый селектор', css('src/ui/x/x.css', 'button { color: var(--text); }')],
    ['css-prefix', 'kit без ui-', css('src/ui/kit/x.css', '.btn { color: var(--text); }')],
    ['css-root', ':root вне style.css', css('src/ui/kit/x.css', ':root { --x: 1px; }')],
    ['deps-runtime', 'runtime-зависимость', checkPackage({ dependencies: { react: '^19' } })],
    ['deps-dev', 'новая dev-зависимость', checkPackage({ devDependencies: { typescript: '1', eslint: '9' } })],
    ['h3-first-launch', 'первый запуск в меню', cat((c) => (c.firstLaunch = 'menu'))],
    ['catalog-default', 'defaultStory нет', cat((c) => (c.defaultStory = 'y'))],
    ['catalog-episode-file', 'эпизод без файла', cat((c) => (c.stories[0].episodes[0].file = 'ch9.json'))],
    ['catalog-episode-n', 'нумерация эпизодов', cat((c) => (c.stories[0].episodes[0].n = 2))],
    ['chapter-start', 'нет стартового экрана', ch((c) => (c.startScene = 'nope'))],
    ['scene-link', 'next в никуда', ch((c) => (c.scenes.s2.next = 'nope'))],
    ['scene-next-choices', 'и next, и choices', ch((c) => (c.scenes.s1.next = 's2'))],
    ['scene-next-choices', 'ни next, ни choices', ch((c) => delete c.scenes.s2.next)],
    ['scene-end', 'конец с next', ch((c) => (c.scenes.end.next = 's1'))],
    ['scene-kind', 'неизвестный kind', ch((c) => (c.scenes.s2.kind = 'video'))],
    ['scene-dead-end', 'петля без выхода', ch((c) => (c.scenes.s2.next = 's1'))],
    ['chapter-no-end', 'нет конца', ch((c) => (c.scenes.end.kind = 'text'))],
    ['scene-unreachable', 'недостижимый экран', ch((c) => (c.scenes.draft = { text: 'x', next: 'end' }))],
    ['choice-moral-paid', 'платный моральный выбор', ch((c) => (c.scenes.s1.choices[0].price = 3))],
    ['choice-price', 'цена не целое', ch((c) => (c.scenes.s1.choices[1].price = 0.5))],
    ['choice-type', 'неизвестный тип выбора', ch((c) => (c.scenes.s1.choices[0].type = 'epic'))],
    ['choice-effects', 'счётчик не целое', ch((c) => (c.scenes.s1.choices[0].effects = { sovest: 0.5 }))],
    ['choice-single', 'выбор из одного', ch((c) => c.scenes.s1.choices.pop())],
    ['choice-no-free', 'все варианты платные', ch((c) => ((c.scenes.s1.choices[0].type = 'romance'), (c.scenes.s1.choices[0].price = 2)))],
    ['choice-id-duplicate', 'id выбора повторяется в истории', checkStoryChoiceIds('ru', 'x', [['ch1.json', ['a', 'b']], ['ch2.json', ['b']]])],
    ['published-choice-id', 'опубликованный выбор пропал', pub(null, (c) => (c.scenes.s1.choices[0].id = 'c_new'))],
    ['published-scene-id', 'опубликованный экран пропал', pub(null, (c) => ((c.scenes.s3 = c.scenes.s2), delete c.scenes.s2, (c.scenes.s1.choices.forEach((x) => (x.next = 's3')))))],
    ['published-story-id', 'опубликованная история пропала', checkPublishedCatalog('ru', { stories: [{ id: 'x', status: 'available' }] }, { stories: [{ id: 'y' }] })],
    // Допустимое — без находок
    [null, 'fetch в api.ts', ts('src/api.ts', "fetch('/config.json')")],
    [null, 'fetch в комментарии', ts('src/ui/x.ts', '// раньше здесь был fetch(url)\n/* window.open(url) */')],
    [null, 'type-импорт api в экране', ts('src/ui/x.ts', "import type { WalletResponse } from '../api'")],
    [null, 'confirmAction и confirmDialog', ts('src/ui/x.ts', 'confirmAction({ title }); confirmDialog(o); const confirm = 1')],
    [null, 'сравнение location.href', ts('src/x.ts', "if (location.href === u) go()")],
    [null, '!important в prefers-reduced-motion', css('src/style.css', '@media (prefers-reduced-motion: reduce) { *, *::before { transition-duration: 0.01ms !important; } }')],
    [null, 'cqh с запасной vh', css('src/style.css', '.x { max-height: 58vh; max-height: 58cqh; }')],
    [null, 'z-index токеном, @container, @media hover', css('src/ui/kit/x.css', '.ui-x { z-index: var(--z-layer); } @container app (max-height: 340px) { .ui-x { gap: 0; } } @media (hover: hover) { .ui-x:hover { color: var(--text); } }')],
    [null, 'чёрная тень и color-mix', css('src/layout/x.css', '.app-x { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5); color: color-mix(in srgb, var(--brass) 20%, transparent); }')],
    [null, 'контекст слоя в kit', css('src/ui/kit/x.css', '.layer--open > .ui-x, .ui-x:is(:hover, :focus) { color: var(--text); }')],
    [null, '@media по окну в shell.css', css('src/layout/shell.css', '@media (min-width: 600px) { .app-shell { width: 440px; } }')],
    [null, 'keyframes', css('src/ui/kit/x.css', '@keyframes ui-x-in { from { opacity: 0; } 50% { opacity: 0.5; } to { opacity: 1; } }')],
    [null, 'разрешённые зависимости', checkPackage({ devDependencies: { typescript: '1', vite: '6', 'playwright-core': '1' } })],
    [null, 'исправная глава', ch(() => {})],
    [null, 'исправный каталог', cat(() => {})],
    [null, 'текст опубликованного выбора поменялся', pub(null, (c) => (c.scenes.s1.choices[0].text = 'новый текст'))],
  ]

  const failures = []
  for (const [rule, name, found] of cases) {
    if (rule && !found.some((f) => f.id === rule)) failures.push(`не поймано: ${name} (правило ${rule})`)
    if (!rule && found.length) failures.push(`ложное срабатывание: ${name} — ${found.map((f) => f.id).join(', ')}`)
  }
  const ruled = new Set(cases.filter((c) => c[0]).map((c) => c[0]))
  return { total: cases.length, rules: ruled.size, failures }
}

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------

function main() {
  const sections = runProject()
  const test = selfTest()
  let errors = 0
  let warnings = 0
  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length))
  for (const s of sections) {
    const e = s.findings.filter((f) => f.level === 'error')
    const w = s.findings.filter((f) => f.level === 'warn')
    errors += e.length
    warnings += w.length
    console.log(`${e.length ? '✗' : '✓'} ${pad(s.name, 14)}${s.note}, замечаний: ${w.length}`)
    for (const f of [...e, ...w]) {
      console.log(`  ${f.level === 'error' ? '✗' : '!'} ${f.where} — ${f.msg} [${f.rule}]`)
      console.log(`      → ${f.fix}`)
    }
  }
  errors += test.failures.length
  console.log(`${test.failures.length ? '✗' : '✓'} ${pad('самопроверка', 14)}образцов: ${test.total}, правил: ${test.rules}, сбоев: ${test.failures.length}`)
  for (const m of test.failures) console.log(`  ✗ ${m}`)
  console.log(errors ? '\n✗ ПРАВИЛА НАРУШЕНЫ' : `\n✓ ПРАВИЛА СОБЛЮДЕНЫ${warnings ? ` (замечаний: ${warnings})` : ''}`)
  process.exit(errors ? 1 : 0)
}

main()
