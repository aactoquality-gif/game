/**
 * Слои поверх экрана: нижняя шторка (меню паузы, как GameMenu у 7H),
 * подтверждение (как RestartPopup у КР) и тост (как NotifyToast у 7H).
 *
 * Слои складываются в стек: «Назад» сначала закрывает верхний слой.
 */

import { h, button, icon } from './dom'
import { t } from '../i18n'
import type { Tap, UiTarget } from '../tracking'

interface Layer {
  root: HTMLElement
  onClose?: () => void
}

const stack: Layer[] = []
let onStackChange: (() => void) | null = null

/**
 * Куда добавлять слои и тосты. app.ts передаёт сюда кадр каркаса: на десктопе шторки и тосты
 * должны жить внутри «телефона», а не растягиваться на всё окно. По умолчанию — body.
 */
let host: HTMLElement = document.body

export function setOverlayHost(el: HTMLElement): void {
  host = el
}

/** app.ts подписывается, чтобы переключать системную кнопку «Назад» Telegram */
export function onOverlayChange(cb: () => void): void {
  onStackChange = cb
}

export function hasOverlay(): boolean {
  return stack.length > 0
}

/** Закрыть верхний слой. true — было что закрывать */
export function closeTopOverlay(): boolean {
  const layer = stack.pop()
  if (!layer) return false
  layer.root.classList.remove('layer--open')
  setTimeout(() => layer.root.remove(), 220)
  layer.onClose?.()
  onStackChange?.()
  return true
}

export function closeAllOverlays(): void {
  while (stack.length) closeTopOverlay()
}

function openLayer(root: HTMLElement, onClose?: () => void): void {
  host.appendChild(root)
  stack.push({ root, onClose })
  requestAnimationFrame(() => root.classList.add('layer--open'))
  onStackChange?.()
}

function scrim(onTap: () => void): HTMLElement {
  const s = h('div', { class: 'scrim' })
  s.addEventListener('click', (e) => {
    e.stopPropagation()
    onTap()
  })
  return s
}

// ---------------------------------------------------------------------------
// Нижняя шторка
// ---------------------------------------------------------------------------

export interface SheetAction {
  label: string
  icon?: Parameters<typeof icon>[0]
  variant?: 'primary' | 'secondary' | 'danger'
  onClick: () => void
  tap?: Tap
}

export function openSheet(opts: { title: string; subtitle?: string; actions: SheetAction[]; extra?: HTMLElement }): void {
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title }, [
    h('div', { class: 'sheet__grip' }),
    h('div', { class: 'sheet__head' }, [
      h('div', { class: 'sheet__title', text: opts.title }),
      opts.subtitle ? h('div', { class: 'sheet__subtitle', text: opts.subtitle }) : null,
    ]),
    h(
      'div',
      { class: 'sheet__actions' },
      opts.actions.map((a) =>
        button(`btn btn--${a.variant ?? 'secondary'} btn--block`, [a.icon ? icon(a.icon) : null, h('span', { text: a.label })], a.onClick, {}, a.tap),
      ),
    ),
    opts.extra ?? null,
  ])
  const root = h('div', { class: 'layer layer--sheet' }, [scrim(closeTopOverlay), sheet])
  openLayer(root)
}

// ---------------------------------------------------------------------------
// Подтверждение
// ---------------------------------------------------------------------------

/** tap — цель аналитики диалога: кнопки отправят её с value confirm / cancel */
export function confirmDialog(opts: {
  title: string
  text: string
  confirm: string
  cancel?: string
  danger?: boolean
  tap?: UiTarget
  onConfirm: () => void
}): void {
  const box = h('div', { class: 'dialog-box', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': opts.title }, [
    h('div', { class: 'dialog-box__title', text: opts.title }),
    h('div', { class: 'dialog-box__text', text: opts.text }),
    h('div', { class: 'dialog-box__actions' }, [
      button('btn btn--secondary', opts.cancel ?? t('common.cancel'), closeTopOverlay, {}, opts.tap && { target: opts.tap, value: 'cancel' }),
      button(
        `btn ${opts.danger ? 'btn--danger' : 'btn--primary'}`,
        opts.confirm,
        () => {
          closeTopOverlay()
          opts.onConfirm()
        },
        {},
        opts.tap && { target: opts.tap, value: 'confirm' },
      ),
    ]),
  ])
  const root = h('div', { class: 'layer layer--dialog' }, [scrim(closeTopOverlay), box])
  openLayer(root)
}

// ---------------------------------------------------------------------------
// Тост
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined

export function toast(text: string): void {
  document.querySelector('.toast')?.remove()
  clearTimeout(toastTimer)
  const t = h('div', { class: 'toast', role: 'status', text })
  host.appendChild(t)
  requestAnimationFrame(() => t.classList.add('toast--show'))
  toastTimer = setTimeout(() => {
    t.classList.remove('toast--show')
    setTimeout(() => t.remove(), 250)
  }, 2200)
}
