/** Мини-хелперы DOM и иконки. Без фреймворков: весь интерфейс — несколько экранов из кнопок и текста */

import { trackTap, type Tap } from '../tracking'

type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { class?: string; text?: string; [attr: string]: string | undefined } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else node.setAttribute(key, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

/**
 * Кнопка с обработчиком; stopPropagation — чтобы тап по кнопке не листал экран.
 * tap — цель аналитики (src/tracking.ts): событие ui_tap уходит до onClick, в контексте экрана,
 * где нажали. У каждой кнопки интерфейса tap обязателен — check:ui проверяет атрибут data-track.
 */
export function button(
  className: string,
  content: Child[] | string,
  onClick: () => void,
  attrs: Record<string, string | undefined> = {},
  tap?: Tap,
): HTMLButtonElement {
  const b = h('button', { class: className, type: 'button', ...attrs }, typeof content === 'string' ? [content] : content)
  if (tap) b.dataset.track = tap.target
  b.addEventListener('click', (event) => {
    event.stopPropagation()
    if (tap) trackTap(tap)
    onClick()
  })
  return b
}

/** SVG-иконка из набора ниже */
export function icon(name: keyof typeof ICONS, className = 'icon'): SVGSVGElement {
  const wrap = document.createElement('span')
  wrap.innerHTML = `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`
  return wrap.firstElementChild as SVGSVGElement
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="none"/>',
  text: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
} as const

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}
