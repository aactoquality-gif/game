/**
 * Стенд проверки каркаса: layout.html (только dev, в прод-сборку не попадает).
 *   /layout.html            — сетка с подсветкой зон и длинным контентом
 *   /layout.html?short      — без строк-заполнителей
 *   /layout.html?immersive  — сразу в режиме чтения
 *   /layout.html?clean      — без подсветки зон
 */

import '../style.css'
import './shell.css'
import { createShell, type ChromeMode } from './shell'
import { h, button } from '../ui/dom'

const params = new URLSearchParams(location.search)
const shell = createShell(document.getElementById('app')!, { debug: !params.has('clean') })

shell.header.append(h('span', { class: 'shell-placeholder', text: 'Хедер здесь' }))
shell.tabbar.append(h('span', { class: 'shell-placeholder', text: 'Таббар здесь' }))

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
  h('div', { class: 'app-page' }, [h('p', { class: 'shell-placeholder', text: 'Контент здесь' }), readout, toggle, ...filler]),
)

function applyChrome(): void {
  shell.setChrome(chrome)
  toggle.textContent = chrome === 'full' ? 'Режим чтения: скрыть хедер и таббар' : 'Вернуть хедер и таббар'
  measure()
}

/** Замеры зон — чтобы проверить сетку цифрами, а не на глаз */
function measure(): void {
  const px = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : 0)
  const bp = getComputedStyle(document.documentElement).getPropertyValue('--bp').trim().replace(/^['"]|['"]$/g, '')
  const doc = document.scrollingElement!
  const docLocked = doc.scrollHeight <= window.innerHeight

  readout.textContent = [
    `брейкпоинт: ${bp}`,
    `экран: ${window.innerWidth}×${window.innerHeight}`,
    `хедер: ${px(shell.root.querySelector('.app-header'))} px · контент: ${px(shell.content)} px · таббар: ${px(shell.root.querySelector('.app-tabbar'))} px`,
    `документ зафиксирован: ${docLocked ? 'да' : 'НЕТ'}`,
  ].join('\n')
}

window.addEventListener('resize', measure)
applyChrome()
