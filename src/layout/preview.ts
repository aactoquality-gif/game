/**
 * Стенд каркаса: layout.html (только dev и check:ui, в сборку игры не входит).
 *   /layout.html            — сетка с подсветкой зон и длинным контентом
 *   /layout.html?short      — без строк-заполнителей
 *   /layout.html?immersive  — сразу в режиме чтения
 *   /layout.html?clean      — без подсветки зон
 * Строки стенда — служебные, мимо t() (исключение в check:ui).
 */

import '../style.css'
import './preview.css'
import { createShell, type ChromeMode } from './shell'
import { h, button } from '../ui/dom'

const params = new URLSearchParams(location.search)
const shell = createShell(document.getElementById('app')!)
if (!params.has('clean')) shell.root.dataset.debug = ''

shell.header.append(h('span', { class: 'shell-placeholder', text: 'Хедер здесь' }))
shell.tabbar.append(h('span', { class: 'shell-placeholder', text: 'Таббар здесь' }))

const badge = h('div', { class: 'shell-badge' })
shell.root.append(badge)

const readout = h('p', { class: 'shell-readout' })
let chrome: ChromeMode = params.has('immersive') ? 'immersive' : 'full'

const toggle = button('btn btn--secondary shell-toggle', '', () => {
  chrome = chrome === 'full' ? 'immersive' : 'full'
  applyChrome()
})

const filler = params.has('short')
  ? []
  : Array.from({ length: 40 }, (_, i) => h('p', { class: 'shell-filler', text: `Строка ${i + 1} — проверка внутреннего скролла` }))

shell.content.append(
  h('div', { class: 'app-page' }, [
    h('p', { class: 'shell-placeholder', text: 'Контент здесь' }),
    readout,
    toggle,
    ...filler,
    h('div', { class: 'shell-probe', 'data-probe': 'fixed' }),
  ]),
)

function applyChrome(): void {
  shell.setChrome(chrome)
  toggle.textContent = chrome === 'full' ? 'Режим чтения: скрыть хедер и таббар' : 'Вернуть хедер и таббар'
  measure()
}

/** Брейкпоинт кадра — из токена --shell-bp, который выставляют @container-правила */
export function frameBreakpoint(): string {
  return getComputedStyle(shell.content).getPropertyValue('--shell-bp').trim().replace(/^['"]|['"]$/g, '')
}

function measure(): void {
  const px = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : 0)
  const frame = shell.root.getBoundingClientRect()
  const bp = frameBreakpoint()
  badge.textContent = `кадр ${Math.round(frame.width)}×${Math.round(frame.height)} · ${bp}`
  readout.textContent = [
    `окно: ${window.innerWidth}×${window.innerHeight}`,
    `кадр: ${Math.round(frame.width)}×${Math.round(frame.height)} · брейкпоинт кадра: ${bp}`,
    `хедер: ${px(shell.root.querySelector('.app-header'))} px · контент: ${px(shell.content)} px · таббар: ${px(shell.root.querySelector('.app-tabbar'))} px`,
  ].join('\n')
}

window.addEventListener('resize', measure)
applyChrome()
