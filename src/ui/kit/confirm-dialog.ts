/**
 * Диалог подтверждения — вид: заголовок, пояснение, «Отмена» и действие.
 *
 * Открывает и закрывает диалог overlay.ts — confirmAction() (обещание да/нет) или confirmDialog().
 * Здесь — только разметка. Опасное действие (danger) — красная кнопка; фокус при открытии overlay.ts
 * ставит на «Отмена», чтобы лишний Enter ничего не сломал. Кнопки — стили .btn из style.css,
 * в узком кадре встают друг под другом, действие сверху. Стили — confirm-dialog.css.
 */

import './confirm-dialog.css'
import { button, h } from '../dom'
import type { Tap } from '../../tracking'

export interface ConfirmViewOptions {
  readonly title: string
  readonly text?: string
  readonly confirm: string
  readonly cancel: string
  readonly danger?: boolean
  readonly confirmTap?: Tap
  readonly cancelTap?: Tap
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

export interface ConfirmView {
  readonly box: HTMLElement
  readonly confirm: HTMLButtonElement
  readonly cancel: HTMLButtonElement
}

let seq = 0

export function confirmView(o: ConfirmViewOptions): ConfirmView {
  const id = `ui-dialog-${++seq}`
  const cancel = button('btn btn--secondary', o.cancel, o.onCancel, {}, o.cancelTap)
  const confirm = button(`btn ${o.danger ? 'btn--danger' : 'btn--primary'}`, o.confirm, o.onConfirm, {}, o.confirmTap)
  const box = h(
    'div',
    {
      class: 'ui-dialog',
      role: 'alertdialog',
      'aria-modal': 'true',
      'aria-labelledby': `${id}-title`,
      'aria-describedby': o.text ? `${id}-text` : undefined,
      'data-tone': o.danger ? 'danger' : 'default',
      tabindex: '-1',
    },
    [
      h('h2', { class: 'ui-dialog__title', id: `${id}-title`, text: o.title }),
      o.text ? h('p', { class: 'ui-dialog__text', id: `${id}-text`, text: o.text }) : null,
      h('div', { class: 'ui-dialog__actions' }, [cancel, confirm]),
    ],
  )
  return { box, confirm, cancel }
}
