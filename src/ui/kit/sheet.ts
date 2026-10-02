/**
 * Нижняя шторка — вид: шапка (полоска, заголовок, подзаголовок, крестик) и прокручиваемое тело.
 *
 * Открывает и закрывает шторку overlay.ts — openBottomSheet(): там стек слоёв, «Назад» Telegram и Esc,
 * фокус, блокировка экрана под шторкой и аналитика. Здесь — только разметка и жест.
 *
 * Жест: шапку можно потянуть вниз. Дальше четверти высоты или быстрым рывком — шторка закрывается
 * (onSwipeDown), иначе возвращается на место. Тело прокручивается само, шапка остаётся на месте:
 * длинная шторка (настройки, «Ещё») не вылезает за кадр даже на 320×568. Стили — sheet.css.
 */

import './sheet.css'
import { h } from '../dom'
import type { Tap } from '../../tracking'
import { iconButton } from './icon-button'

export interface SheetViewOptions {
  readonly title: string
  readonly subtitle?: string
  readonly content: readonly Node[]
  /** Крестик в шапке; null — без крестика (закрыть можно «Назад», Esc, фоном и жестом) */
  readonly close: { readonly label: string; readonly tap: Tap; readonly onClick: () => void } | null
  readonly onSwipeDown: () => void
}

export interface SheetView {
  /** Сама шторка: role="dialog", получает фокус при открытии */
  readonly sheet: HTMLElement
  /** Тело — сюда можно дописывать и заменять содержимое после открытия */
  readonly body: HTMLElement
}

let seq = 0

export function sheetView(o: SheetViewOptions): SheetView {
  const id = `ui-sheet-${++seq}`
  const title = h('h2', { class: 'ui-sheet__title', id: `${id}-title`, text: o.title })
  const head = h('div', { class: 'ui-sheet__head' }, [
    h('div', { class: 'ui-sheet__titles' }, [title, o.subtitle ? h('p', { class: 'ui-sheet__subtitle', text: o.subtitle }) : null]),
    o.close ? iconButton({ icon: 'close', label: o.close.label, onClick: o.close.onClick, tap: o.close.tap, variant: 'tonal', size: 's' }) : null,
  ])
  const grab = h('div', { class: 'ui-sheet__grab' }, [h('div', { class: 'ui-sheet__grip', 'aria-hidden': 'true' }), head])
  const body = h('div', { class: 'ui-sheet__body' }, [...o.content])
  const sheet = h('section', { class: 'ui-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title.id, tabindex: '-1' }, [grab, body])
  dragToDismiss(grab, sheet, o.onSwipeDown)
  return { sheet, body }
}

/** Доля высоты шторки, после которой отпущенная шторка закрывается */
const DISMISS_SHARE = 0.25
/** Рывок: быстрее этого (px/мс) и дальше FLICK_MIN_PX — закрыть, даже если протянули немного */
const FLICK_SPEED = 0.5
const FLICK_MIN_PX = 40

function dragToDismiss(handle: HTMLElement, sheet: HTMLElement, onDismiss: () => void): void {
  let pointer: number | null = null
  let startY = 0
  let startT = 0
  let dy = 0

  const settle = (): void => {
    pointer = null
    delete sheet.dataset.dragging
  }

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return
    pointer = e.pointerId
    startY = e.clientY
    startT = e.timeStamp
    dy = 0
    handle.setPointerCapture(e.pointerId)
    sheet.dataset.dragging = ''
  })
  handle.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointer) return
    dy = Math.max(0, e.clientY - startY)
    sheet.style.setProperty('--ui-sheet-drag', `${dy}px`)
  })
  handle.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pointer) return
    const speed = dy / Math.max(1, e.timeStamp - startT)
    settle()
    if (dy > sheet.offsetHeight * DISMISS_SHARE || (dy > FLICK_MIN_PX && speed > FLICK_SPEED)) onDismiss()
    else sheet.style.removeProperty('--ui-sheet-drag')
  })
  handle.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== pointer) return
    settle()
    sheet.style.removeProperty('--ui-sheet-drag')
  })
}
