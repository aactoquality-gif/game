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

/**
 * Классы иконки — закрытый список: размеры и поворот из style.css. Нужен новый вариант — добавь его сюда
 * и стиль в CSS; произвольная строка не пройдёт проверку типов.
 */
export type IconClass = 'icon' | 'icon icon--sm' | 'icon icon--down'

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Общие атрибуты корневого <svg> всех иконок */
const SVG_ATTRS = {
  viewBox: '0 0 24 24',
  'aria-hidden': 'true',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const

/**
 * SVG-иконка из набора ниже. Собирается через createElementNS + setAttribute, без innerHTML:
 * строки не разбираются как разметка, поэтому ни класс, ни данные иконки не могут внедрить HTML.
 */
export function icon(name: keyof typeof ICONS, className: IconClass = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', className)
  for (const [key, value] of Object.entries(SVG_ATTRS)) svg.setAttribute(key, value)
  for (const [tag, attrs] of ICONS[name]) {
    const shape = document.createElementNS(SVG_NS, tag)
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, value)
    svg.append(shape)
  }
  return svg
}

/** Имя иконки из набора ниже — для компонентов, которые принимают иконку параметром (src/ui/kit) */
export type IconName = keyof typeof ICONS

/** Фигура иконки: тег SVG и его атрибуты */
type IconShape = readonly ['path' | 'rect', Readonly<Record<string, string>>]

const ICONS = {
  back: [['path', { d: 'M15 5l-7 7 7 7' }]],
  menu: [['path', { d: 'M4 7h16M4 12h16M4 17h16' }]],
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  play: [['path', { d: 'M8 5.5v13l10.5-6.5z', fill: 'currentColor', stroke: 'none' }]],
  check: [['path', { d: 'M5 12.5l4.5 4.5L19 7.5' }]],
  lock: [
    ['rect', { x: '5', y: '11', width: '14', height: '9', rx: '2' }],
    ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  ],
  restart: [
    ['path', { d: 'M4 12a8 8 0 1 0 2.4-5.7' }],
    ['path', { d: 'M4 4v4.5h4.5' }],
  ],
  book: [
    ['path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z' }],
    ['path', { d: 'M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5' }],
  ],
  star: [
    [
      'path',
      { d: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z', fill: 'currentColor', stroke: 'none' },
    ],
  ],
  text: [['path', { d: 'M4 7V5h16v2M9 19h6M12 5v14' }]],
  // Хедер (шаг 4.1): уведомления и настройки
  bell: [
    ['path', { d: 'M18 9.5a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17s-2.5-1.5-2.5-8' }],
    ['path', { d: 'M10.3 20.5a2 2 0 0 0 3.4 0' }],
  ],
  settings: [
    [
      'path',
      {
        d:
          'M10.08 4.85L10.33 2.55A9.6 9.6 0 0 1 13.67 2.55L13.92 4.85A7.4 7.4 0 0 1 15.7 5.59L17.51 4.14A9.6 9.6 0 0 1 19.86 6.49' +
          'L18.41 8.3A7.4 7.4 0 0 1 19.15 10.08L21.45 10.33A9.6 9.6 0 0 1 21.45 13.67L19.15 13.92A7.4 7.4 0 0 1 18.41 15.7' +
          'L19.86 17.51A9.6 9.6 0 0 1 17.51 19.86L15.7 18.41A7.4 7.4 0 0 1 13.92 19.15L13.67 21.45A9.6 9.6 0 0 1 10.33 21.45' +
          'L10.08 19.15A7.4 7.4 0 0 1 8.3 18.41L6.49 19.86A9.6 9.6 0 0 1 4.14 17.51L5.59 15.7A7.4 7.4 0 0 1 4.85 13.92' +
          'L2.55 13.67A9.6 9.6 0 0 1 2.55 10.33L4.85 10.08A7.4 7.4 0 0 1 5.59 8.3L4.14 6.49A9.6 9.6 0 0 1 6.49 4.14' +
          'L8.3 5.59A7.4 7.4 0 0 1 10.08 4.85z',
      },
    ],
    ['path', { d: 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0' }],
  ],
} as const satisfies Record<string, readonly IconShape[]>

export function clear(node: HTMLElement): void {
  node.replaceChildren()
}
