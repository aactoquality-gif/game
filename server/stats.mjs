/**
 * Отчёт по гипотезам Г1 из events.jsonl.
 *
 * H1 «История держит»: сколько тестеров дочитали эпизод за один присест
 *    (порог ≥ 5 из 8). Присест = одно открытие игры (session), которое началось
 *    с первого экрана и закончилось карточкой конца.
 * H3 «Первая минута»: на каком экране тестер через 3 минуты после старта
 *    (порог — не раньше экрана 5). Экран считается по глубине: сколько разных
 *    экранов человек уже увидел.
 * H2 — качественная (пересказ), в аналитике не меряется.
 *
 * Плюс воронка по экранам (кривая отвала) и распределение выборов.
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const H3_WINDOW_MS = 3 * 60 * 1000
const H3_MIN_DEPTH = 5
const H1_MIN_TESTERS = 5
const H1_RATIO = 5 / 8

// ---------------------------------------------------------------------------
// Загрузка
// ---------------------------------------------------------------------------

export function loadEvents(file) {
  if (!existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch { /* битая строка — пропускаем */ }
  }
  return out
}

export function loadChapter(distDir, episode) {
  try {
    return JSON.parse(readFileSync(join(distDir, 'content', 'ru', `ch${episode}.json`), 'utf8'))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Расчёт
// ---------------------------------------------------------------------------

const playerKey = (e) => (e.user_id != null ? `tg:${e.user_id}` : `dev:${e.device ?? 'unknown'}`)

function median(values) {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * @param {object[]} allEvents
 * @param {{ episode?: number, chapter?: object|null, from?: number, exclude?: string[] }} opts
 */
export function buildReport(allEvents, { episode = 1, chapter = null, from = 0, exclude = [] } = {}) {
  const events = allEvents
    .filter((e) => e.story === 'game' && e.episode === episode && (e.server_ts ?? e.ts) >= from)
    .filter((e) => !exclude.includes(String(e.user_id)) && !exclude.includes(String(e.device)))
    .sort((a, b) => a.ts - b.ts)

  const sceneOrder = chapter
    ? Object.keys(chapter.scenes)
    : [...new Set(events.filter((e) => e.event === 'screen_view').map((e) => e.screen))]
  const startScene = chapter?.startScene ?? sceneOrder[0]

  // Игроки
  const byPlayer = new Map()
  for (const e of events) {
    const key = playerKey(e)
    let p = byPlayer.get(key)
    if (!p) {
      p = { key, userId: e.user_id ?? null, name: null, device: e.device ?? null, platform: e.platform, verified: false, events: [] }
      byPlayer.set(key, p)
    }
    if (e.user_name) p.name = e.user_name
    if (e.verified) p.verified = true
    p.events.push(e)
  }

  const players = [...byPlayer.values()]
    .map((p) => analyzePlayer(p, startScene))
    .filter((p) => p.screensSeen.size > 0)
    .sort((a, b) => a.firstTs - b.firstTs)

  // H1
  const n = players.length
  const oneSitting = players.filter((p) => p.oneSitting).length
  const completed = players.filter((p) => p.completed).length
  const h1 = {
    testers: n,
    completed,
    oneSitting,
    verdict: n < H1_MIN_TESTERS ? 'мало данных' : oneSitting / n >= H1_RATIO ? 'проходит' : 'не проходит',
  }

  // H3
  const h3Rows = players.filter((p) => p.h3 !== null)
  const depths = h3Rows.map((p) => p.h3.depth)
  const med = median(depths)
  const h3 = {
    measured: h3Rows.length,
    passed: depths.filter((d) => d >= H3_MIN_DEPTH).length,
    medianDepth: med,
    verdict: med === null ? 'нет данных' : med >= H3_MIN_DEPTH ? 'проходит' : 'не проходит',
  }

  // Воронка
  const started = players.filter((p) => p.screensSeen.has(startScene)).length || n
  const funnel = sceneOrder.map((id, i) => {
    const seen = players.filter((p) => p.screensSeen.has(id)).length
    const stopped = players.filter((p) => !p.completed && p.lastScreen === id).length
    const scene = chapter?.scenes[id]
    return { n: i + 1, id, kind: scene?.kind ?? 'text', seen, share: started ? seen / started : 0, stopped }
  })

  // Выборы: первое прохождение каждого игрока
  const choiceCounts = new Map()
  for (const p of players) {
    for (const id of p.firstRunChoices) choiceCounts.set(id, (choiceCounts.get(id) ?? 0) + 1)
  }
  const choices = []
  if (chapter) {
    for (const [sceneId, scene] of Object.entries(chapter.scenes)) {
      if (!scene.choices?.length) continue
      const options = scene.choices.map((c) => ({ id: c.id, text: c.text, type: c.type ?? 'neutral', count: choiceCounts.get(c.id) ?? 0 }))
      choices.push({ sceneId, options, total: options.reduce((s, o) => s + o.count, 0) })
    }
  } else if (choiceCounts.size) {
    choices.push({ sceneId: '—', options: [...choiceCounts].map(([id, count]) => ({ id, text: id, type: '', count })), total: 0 })
  }

  return {
    episode,
    events: events.length,
    h1,
    h3,
    players: players.map(({ events: _e, screensSeen, firstRunChoices: _c, ...rest }) => ({ ...rest, screensSeen: screensSeen.size })),
    funnel,
    choices,
  }
}

function analyzePlayer(p, startScene) {
  const ev = p.events
  const views = ev.filter((e) => e.event === 'screen_view' && typeof e.screen === 'string' && e.screen)
  const completes = ev.filter((e) => e.event === 'episode_complete')
  const runs = [...new Set(ev.map((e) => e.run))]

  // H1: присест, который начался с первого экрана и закончился концом эпизода
  let oneSitting = false
  let sittingMs = null
  for (const c of completes) {
    const sv = views.filter((v) => v.session === c.session && v.run === c.run)
    if (sv.length && sv[0].screen === startScene) {
      oneSitting = true
      const ms = c.ts - sv[0].ts
      if (sittingMs === null || ms < sittingMs) sittingMs = ms
    }
  }

  // H3: где человек через 3 минуты после старта первого прохождения
  const firstRun = views.length ? Math.min(...views.map((v) => v.run)) : null
  let h3 = null
  if (firstRun !== null) {
    const runViews = views.filter((v) => v.run === firstRun)
    const startEv = ev.find((e) => e.event === 'episode_start' && e.run === firstRun)
    const t0 = startEv?.ts ?? runViews.find((v) => v.screen === startScene)?.ts ?? null
    if (t0 !== null) {
      const within = runViews.filter((v) => v.ts >= t0 && v.ts <= t0 + H3_WINDOW_MS)
      const reachedWindow = ev.some((e) => e.run === firstRun && e.ts > t0 + H3_WINDOW_MS)
      const finishedEarly = completes.some((c) => c.run === firstRun && c.ts <= t0 + H3_WINDOW_MS)
      if (within.length) {
        h3 = {
          depth: new Set(within.map((v) => v.screen)).size,
          screen: within[within.length - 1].screen,
          note: finishedEarly ? 'дочитал до 3:00' : reachedWindow ? '' : 'вышел до 3:00',
        }
      }
    }
  }

  const firstRunChoices = ev
    .filter((e) => e.event === 'choice_made' && e.run === firstRun && e.data?.choice_id)
    .map((e) => String(e.data.choice_id))

  const maxDepth = Math.max(0, ...runs.map((r) => new Set(views.filter((v) => v.run === r).map((v) => v.screen)).size))

  return {
    key: p.key,
    label: p.name ? `${p.name}${p.userId ? ` · ${p.userId}` : ''}` : p.userId ? `id ${p.userId}` : `браузер ${String(p.device).slice(-4)}`,
    platform: p.platform,
    verified: p.verified,
    runs: runs.length,
    screensSeen: new Set(views.map((v) => v.screen)),
    maxDepth,
    completed: completes.length > 0,
    oneSitting,
    sittingMs,
    h3,
    lastScreen: views.length ? views[views.length - 1].screen : null,
    firstTs: ev[0].ts,
    lastTs: ev[ev.length - 1].ts,
    sessions: new Set(ev.map((e) => e.session)).size,
    firstRunChoices,
  }
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const pct = (x) => `${Math.round(x * 100)}%`
const mmss = (ms) => (ms === null ? '—' : `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`)
const msk = (ts) =>
  new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function badge(verdict) {
  const cls = verdict === 'проходит' ? 'ok' : verdict === 'не проходит' ? 'bad' : 'wait'
  return `<span class="badge ${cls}">${esc(verdict)}</span>`
}

/**
 * @param {ReturnType<typeof buildReport>} r
 * @param {{ verifyOn: boolean, dataDir: string, query: string }} meta
 */
export function renderHtml(r, meta) {
  const { h1, h3 } = r
  const maxSeen = Math.max(1, ...r.funnel.map((f) => f.seen))

  const playerRows = r.players
    .map(
      (p) => `<tr>
  <td>${esc(p.label)}${p.verified ? '' : ' <span class="muted" title="Подпись Telegram не проверялась">?</span>'}</td>
  <td>${esc(p.platform)}</td>
  <td class="num">${p.maxDepth}</td>
  <td class="c">${p.completed ? '✓' : '—'}</td>
  <td class="c">${p.oneSitting ? '✓' : '—'}</td>
  <td class="num">${mmss(p.sittingMs)}</td>
  <td>${p.h3 ? `${p.h3.depth} <span class="muted">(${esc(p.h3.screen)})</span> ${p.h3.depth >= H3_MIN_DEPTH ? '✓' : '✗'} <span class="muted">${esc(p.h3.note)}</span>` : '<span class="muted">нет старта</span>'}</td>
  <td class="num">${p.runs}</td>
  <td class="num">${p.sessions}</td>
  <td>${esc(p.completed ? 'конец' : p.lastScreen)}</td>
  <td class="muted">${msk(p.lastTs)}</td>
</tr>`,
    )
    .join('\n')

  const funnelRows = r.funnel
    .map(
      (f) => `<tr>
  <td class="num muted">${f.n}</td>
  <td>${esc(f.id)}${f.kind !== 'text' ? ` <span class="muted">${esc(f.kind)}</span>` : ''}</td>
  <td class="num">${f.seen}</td>
  <td class="bar"><span style="width:${Math.round((f.seen / maxSeen) * 100)}%"></span></td>
  <td class="num">${pct(f.share)}</td>
  <td class="num">${f.stopped || ''}</td>
</tr>`,
    )
    .join('\n')

  const choiceBlocks = r.choices
    .map(
      (c) => `<h3>${esc(c.sceneId)}</h3>
<div class="scroll"><table><tbody>${c.options
        .map(
          (o) => `<tr><td class="wrap">${esc(o.text)} <span class="muted">${esc(o.id)} · ${esc(o.type)}</span></td>
<td class="num">${o.count}</td><td class="num">${c.total ? pct(o.count / c.total) : '—'}</td></tr>`,
        )
        .join('')}</tbody></table></div>`,
    )
    .join('\n')

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Г1 · эпизод ${r.episode}</title>
<style>
:root{--bg:#fff;--fg:#1b1a1f;--muted:#8a8791;--line:#e6e4ea;--ok:#1f8a4c;--bad:#c0392b;--wait:#9a7b12;--bar:#6c5ce7}
@media (prefers-color-scheme:dark){:root{--bg:#14121a;--fg:#ece9f1;--muted:#8d8997;--line:#2b2833;--bar:#8b7cf6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 8px}h3{font-size:14px;margin:16px 0 4px}
.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:16px}
.card{border:1px solid var(--line);border-radius:10px;padding:14px}.card b{font-size:26px;display:block;margin:4px 0}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600;color:#fff}
.ok{background:var(--ok)}.bad{background:var(--bad)}.wait{background:var(--wait)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-weight:600;font-size:12px;color:var(--muted)}td.wrap{white-space:normal;min-width:180px}.meta{overflow-wrap:anywhere}.num{text-align:right;font-variant-numeric:tabular-nums}.c{text-align:center}
.bar{width:40%}.bar span{display:block;height:8px;border-radius:4px;background:var(--bar)}
form{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}input{padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit}
a{color:var(--bar)}
</style></head><body><main>
<h1>Г1 · эпизод ${r.episode}</h1>
<div class="muted meta">${r.events} событий · проверка подписи Telegram: ${meta.verifyOn ? 'включена' : '<b>выключена (нет BOT_TOKEN)</b>'} · данные: ${esc(meta.dataDir)}</div>

<form method="get">
  <input type="hidden" name="key" value="${esc(meta.key)}">
  <label>с даты <input type="date" name="from" value="${esc(meta.from)}"></label>
  <label>исключить ID <input name="exclude" value="${esc(meta.exclude)}" placeholder="через запятую"></label>
  <button type="submit">Применить</button>
  <a href="/api/events.jsonl?key=${encodeURIComponent(meta.key)}">скачать сырые события</a>
</form>

<div class="cards">
  <div class="card">H1 · история держит ${badge(h1.verdict)}
    <b>${h1.oneSitting} из ${h1.testers}</b>
    <span class="muted">дочитали за один присест · порог ≥ 5 из 8<br>всего дочитали: ${h1.completed}. Второе условие («сами спрашивают „а дальше?“») — из интервью</span></div>
  <div class="card">H3 · первая минута ${badge(h3.verdict)}
    <b>экран ${h3.medianDepth ?? '—'}</b>
    <span class="muted">медиана через 3:00 · порог — не раньше экрана 5<br>дошли до 5-го: ${h3.passed} из ${h3.measured}</span></div>
  <div class="card">H2 · жанр читается
    <b>—</b><span class="muted">качественная: пересказ своими словами, считается по интервью</span></div>
</div>

<h2>Тестеры</h2>
<div class="scroll"><table>
<thead><tr><th>Кто</th><th>Где</th><th class="num">Экранов</th><th>Дочитал</th><th>Присест</th><th class="num">Время</th><th>Экран через 3:00</th><th class="num">Прох.</th><th class="num">Сессий</th><th>Последний экран</th><th>Был</th></tr></thead>
<tbody>${playerRows || '<tr><td colspan="11" class="muted">Пока никого</td></tr>'}</tbody></table></div>

<h2>Воронка — где отваливаются</h2>
<div class="scroll"><table>
<thead><tr><th class="num">#</th><th>Экран</th><th class="num">Видели</th><th></th><th class="num">От старта</th><th class="num">Ушли здесь</th></tr></thead>
<tbody>${funnelRows}</tbody></table></div>

<h2>Выборы <span class="muted">(первое прохождение)</span></h2>
${choiceBlocks || '<p class="muted">Выборов пока нет</p>'}
</main></body></html>`
}
