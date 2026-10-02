/**
 * Чип — короткая метка-«пилюля» с текстом, иконкой и счётчиком. Три вида:
 *
 *   chip({ text })                                    — метка без нажатия: жанр, «18+», статус
 *   actionChip({ text, icon, onClick, tap })          — действие одним касанием: «★ 120» → магазин
 *   filterChip({ text, selected, onChange, tap })     — фильтр: включается и выключается сам,
 *                                                       aria-pressed; выбранный — с галочкой, не только цветом
 *   chipGroup(label, [...])                           — ряд чипов с переносом, role="group" с подписью
 *
 * Счётчик (count) — нейтральный бейдж внутри чипа, у выбранного фильтра — латунный; 0 или null — скрыт.
 * Длинный текст обрезается многоточием, чип не шире ряда.
 * Как у кнопки-иконки: виден чип высотой 32 px, зона касания — 44 px по высоте (поля за пределами чипа).
 * Тексты — через t() (или контент: жанр истории). Аналитика — обязательный tap. Стили — chip.css.
 */

import './chip.css'
import { button, h, icon, type IconName } from '../dom'
import type { Tap } from '../../tracking'
import { badge, setBadge } from './badge'

export interface ChipContent {
  readonly text: string
  readonly icon?: IconName
  readonly count?: number | null
}

export interface ActionChipOptions extends ChipContent {
  readonly onClick: () => void
  readonly tap: Tap
  readonly disabled?: boolean
}

export interface FilterChipOptions extends ChipContent {
  readonly selected: boolean
  /** Вызывается после переключения — с новым состоянием */
  readonly onChange: (selected: boolean) => void
  readonly tap: Tap
  readonly disabled?: boolean
}

/** Иконка, текст и счётчик — общие для всех видов */
function parts(o: ChipContent, withCheck: boolean): Node[] {
  const out: Node[] = []
  if (withCheck) {
    const check = icon('check')
    check.classList.add('ui-chip__check')
    out.push(check)
  }
  if (o.icon) {
    const lead = icon(o.icon)
    lead.classList.add('ui-chip__icon')
    out.push(lead)
  }
  out.push(h('span', { class: 'ui-chip__text', text: o.text }))
  const count = badge(null)
  count.classList.add('ui-chip__count')
  setBadge(count, o.count ? { count: o.count, tone: 'neutral' } : null)
  out.push(count)
  return out
}

/** Метка без нажатия */
export function chip(o: ChipContent): HTMLSpanElement {
  return h('span', { class: 'ui-chip', 'data-kind': 'static' }, parts(o, false))
}

/** Чип-действие */
export function actionChip(o: ActionChipOptions): HTMLButtonElement {
  return button('ui-chip', parts(o, false), o.onClick, { 'data-kind': 'action', disabled: o.disabled ? '' : undefined }, o.tap)
}

/** Чип-фильтр: переключается сам и сообщает новое состояние */
export function filterChip(o: FilterChipOptions): HTMLButtonElement {
  const el: HTMLButtonElement = button(
    'ui-chip',
    parts(o, true),
    () => {
      const next = !isChipSelected(el)
      setChipSelected(el, next)
      o.onChange(next)
    },
    { 'data-kind': 'filter', 'aria-pressed': String(o.selected), disabled: o.disabled ? '' : undefined },
    o.tap,
  )
  return el
}

export function isChipSelected(el: HTMLElement): boolean {
  return el.getAttribute('aria-pressed') === 'true'
}

/** Выбрать или снять фильтр снаружи (сброс фильтров, состояние из store) — onChange не вызывается */
export function setChipSelected(el: HTMLElement, selected: boolean): void {
  if (el.dataset.kind === 'filter') el.setAttribute('aria-pressed', String(selected))
}

/** Обновить счётчик чипа; 0 или null — скрыть */
export function setChipCount(el: HTMLElement, count: number | null): void {
  const mark = el.querySelector<HTMLElement>('.ui-chip__count')
  if (mark) setBadge(mark, count ? { count, tone: 'neutral' } : null)
}

/** Ряд чипов с переносом. label — подпись группы для скринридера, через t() */
export function chipGroup(label: string, chips: readonly HTMLElement[]): HTMLDivElement {
  return h('div', { class: 'ui-chips', role: 'group', 'aria-label': label }, [...chips])
}
