/**
 * Сегментный переключатель — один вариант из 2–5: размер текста, тема, язык.
 *
 *   segmented({ label: t('…'), options: [{ value: 's', label: t('…') }, …], value: 's', onChange, tap: 'pause.textSize' })
 *
 * role="radiogroup" из кнопок role="radio": в порядке Tab — только выбранный сегмент, стрелки
 * переводят выбор (←/→ и ↑/↓, Home/End), недоступные пропускаются — как у радиокнопок.
 * Выбранный подсвечен «ползунком», который переезжает к нему. glyph — крупный знак над подписью
 * (размер текста: «А» трёх кеглей, glyphSize в px). Аналитика — ui_tap с value варианта. Стили — segmented.css.
 */

import './segmented.css'
import { button, h } from '../dom'
import type { UiTarget } from '../../tracking'

export interface SegmentOption {
  readonly value: string
  readonly label: string
  /** Крупный знак над подписью — например, «А» для размера текста */
  readonly glyph?: string
  /** Кегль знака, px */
  readonly glyphSize?: number
  readonly disabled?: boolean
}

export interface SegmentedOptions {
  /** Подпись группы для скринридера — через t() */
  readonly label: string
  readonly options: readonly SegmentOption[]
  readonly value: string
  readonly onChange: (value: string) => void
  /** Цель аналитики; value — выбранный вариант */
  readonly tap: UiTarget
  readonly disabled?: boolean
}

export function segmented(o: SegmentedOptions): HTMLDivElement {
  const root = h('div', { class: 'ui-seg', role: 'radiogroup', 'aria-label': o.label })
  root.style.setProperty('--n', String(o.options.length))
  if (o.disabled) root.setAttribute('aria-disabled', 'true')

  const items = o.options.map((opt) => {
    const item: HTMLButtonElement = button(
      `ui-seg__item${opt.glyph ? ' ui-seg__item--glyph' : ''}`,
      [
        opt.glyph ? h('span', { class: 'ui-seg__glyph', text: opt.glyph, 'aria-hidden': 'true' }) : null,
        h('span', { class: 'ui-seg__label', text: opt.label }),
      ],
      () => {
        if (isSegmentSelected(item)) return
        setSegmentedValue(root, opt.value)
        o.onChange(opt.value)
      },
      { role: 'radio', 'data-value': opt.value, disabled: o.disabled || opt.disabled ? '' : undefined },
      { target: o.tap, value: opt.value },
    )
    if (opt.glyphSize) item.style.setProperty('--ui-seg-glyph', `${opt.glyphSize}px`)
    return item
  })
  root.append(...items)

  // Стрелки: следующий доступный вариант, по кругу. Выбор = нажатие (та же аналитика и onChange)
  root.addEventListener('keydown', (event) => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
    const enabled = items.filter((b) => !b.disabled)
    if (!enabled.length) return
    const current = enabled.indexOf(document.activeElement as HTMLButtonElement)
    let next: HTMLButtonElement | undefined
    if (event.key in keys) next = enabled[(Math.max(0, current) + keys[event.key] + enabled.length) % enabled.length]
    else if (event.key === 'Home') next = enabled[0]
    else if (event.key === 'End') next = enabled[enabled.length - 1]
    if (!next) return
    event.preventDefault()
    event.stopPropagation() // стрелки не листают эпизод под шторкой
    next.focus()
    next.click()
  })

  setSegmentedValue(root, o.value)
  return root
}

function isSegmentSelected(item: HTMLElement): boolean {
  return item.getAttribute('aria-checked') === 'true'
}

/** Выбрать вариант снаружи (состояние из store) — onChange не вызывается */
export function setSegmentedValue(root: HTMLElement, value: string): void {
  const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.ui-seg__item'))
  const index = items.findIndex((item) => item.dataset.value === value)
  items.forEach((item, i) => {
    item.setAttribute('aria-checked', String(i === index))
    item.tabIndex = i === index ? 0 : -1 // в порядке Tab — только выбранный
  })
  // Ничего не выбрано — в группу всё равно можно попасть с клавиатуры: через первый доступный
  if (index === -1) {
    const first = items.find((item) => !item.disabled)
    if (first) first.tabIndex = 0
  }
  root.dataset.empty = index === -1 ? 'true' : 'false'
  root.style.setProperty('--i', String(Math.max(0, index)))
}

export function segmentedValue(root: HTMLElement): string {
  return root.querySelector<HTMLElement>('.ui-seg__item[aria-checked="true"]')?.dataset.value ?? ''
}
