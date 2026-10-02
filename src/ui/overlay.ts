/**
 * Слои поверх экрана: нижняя шторка (меню паузы, как GameMenu у 7H),
 * подтверждение (как RestartPopup у КР) и тост (как NotifyToast у 7H).
 *
 * Слои складываются в стек: «Назад» сначала закрывает верхний слой. Стек отвечает за поведение,
 * вид шторки и диалога — src/ui/kit/sheet.ts и confirm-dialog.ts:
 *   openBottomSheet({ title, content, tap })   — шторка с любым содержимым, крестиком и жестом вниз
 *   confirmAction({ title, confirm, tap })     — диалог, обещание: true — подтвердили, false — нет
 *   openSheet / confirmDialog                  — прежние вызовы экранов, работают через новые
 *
 * Что делает стек для каждого слоя:
 *   — фокус уходит в слой и возвращается на кнопку, которая его открыла;
 *   — всё под верхним слоем «инертно» (inert): не нажимается, не в порядке Tab, не читается скринридером;
 *   — закрытие идемпотентно, а закрывающийся слой (220 мс анимации) глотает тапы: двойной тап по «Отмена»
 *     не закроет шторку под диалогом и не нажмёт кнопку под ним;
 *   — причина закрытия: «Назад», Esc, фон, жест — отказ игрока, уходит в аналитику (ui_tap с целью слоя).
 * «Назад» Telegram, Esc и системная «Назад» браузера приходят из app.ts: closeTopOverlay('back' | 'esc').
 */

import { h, button, icon } from './dom'
import { t } from '../i18n'
import { trackTap, type Tap, type UiTarget } from '../tracking'
import { sheetView } from './kit/sheet'
import { confirmView } from './kit/confirm-dialog'

/**
 * Как закрылся слой: back — «Назад» Telegram или браузера, esc — клавиша Esc, scrim — тап по фону,
 * swipe — шторку смахнули вниз, button — крестик; action — кнопка внутри слоя или код; nav — переход между экранами.
 */
export type CloseReason = 'back' | 'esc' | 'scrim' | 'swipe' | 'button' | 'action' | 'nav'

/** Отказ игрока — пишется в аналитику: value причины у цели слоя. Крестик пишет сама кнопка */
const DISMISS_REASONS: readonly CloseReason[] = ['back', 'esc', 'scrim', 'swipe']

/** Длительность анимации закрытия — столько закрывающийся слой ещё на экране */
const CLOSE_MS = 220

interface Layer {
  root: HTMLElement
  onClose?: (reason: CloseReason) => void
  /** Цель аналитики слоя: закрытие отказом уходит как ui_tap { target: tap, value: причина } */
  tap?: UiTarget
  /** Что было в фокусе до открытия — туда фокус вернётся */
  opener: HTMLElement | null
}

/** Управление открытым слоем */
export interface LayerHandle {
  readonly root: HTMLElement
  /** Закрыть этот слой (не обязательно верхний). Повторный вызов ничего не делает */
  close(reason?: CloseReason): void
  isOpen(): boolean
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

/**
 * Закрыть верхний слой. true — было что закрывать.
 * reason — как закрыли: app.ts передаёт 'back' (Telegram, браузер) и 'esc'; кнопки внутри слоя — 'action'.
 */
export function closeTopOverlay(reason: CloseReason = 'action'): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  closeLayer(top, reason)
  return true
}

/** Закрыть все слои — переход между экранами, в аналитику не пишется */
export function closeAllOverlays(): void {
  while (stack.length) closeTopOverlay('nav')
}

function closeLayer(layer: Layer, reason: CloseReason): void {
  const i = stack.indexOf(layer)
  if (i === -1) return // уже закрыт: второй тап того же двойного тапа
  stack.splice(i, 1)

  // Ещё 220 мс слой виден (анимация), но уже ничего не делает: тапы гасятся здесь, а не проваливаются ниже
  const root = layer.root
  root.classList.remove('layer--open')
  root.dataset.closing = ''
  root.setAttribute('aria-hidden', 'true')
  root.addEventListener('click', swallow, true)
  setTimeout(() => root.remove(), CLOSE_MS)

  if (layer.tap && DISMISS_REASONS.includes(reason)) trackTap({ target: layer.tap, value: reason })
  syncInert()
  restoreFocus(layer)
  layer.onClose?.(reason)
  onStackChange?.()
}

function swallow(event: Event): void {
  event.stopPropagation()
  event.preventDefault()
}

function openLayer(root: HTMLElement, opts: { onClose?: (reason: CloseReason) => void; tap?: UiTarget; focus?: () => HTMLElement | null } = {}): LayerHandle {
  const active = document.activeElement
  const layer: Layer = {
    root,
    onClose: opts.onClose,
    tap: opts.tap,
    opener: active instanceof HTMLElement && active !== document.body ? active : null,
  }
  host.appendChild(root)
  stack.push(layer)
  syncInert()
  requestAnimationFrame(() => root.classList.add('layer--open'))
  // Фокус — в слой: скринридер объявляет его, Tab ходит по его кнопкам. preventScroll — слой ещё за краем
  ;(opts.focus?.() ?? root.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]'))?.focus({ preventScroll: true })
  onStackChange?.()
  return { root, close: (reason = 'action') => closeLayer(layer, reason), isOpen: () => stack.includes(layer) }
}

/** Элементы, которым inert поставил стек (чужой inert не трогаем) */
const inertByStack = new Set<HTMLElement>()

/**
 * Под верхним слоем — всё инертно: экран, хедер, таббар и нижние слои. Тосты остаются живыми:
 * это сообщения для скринридера (role="status"). Закрывающиеся слои уже гасят тапы сами.
 */
function syncInert(): void {
  const top = stack[stack.length - 1]?.root
  const want = new Set<HTMLElement>()
  if (top) {
    for (const el of Array.from(host.children)) {
      if (!(el instanceof HTMLElement) || el === top || el.classList.contains('toast') || 'closing' in el.dataset) continue
      want.add(el)
    }
  }
  for (const el of inertByStack) {
    if (want.has(el)) continue
    el.inert = false
    inertByStack.delete(el)
  }
  for (const el of want) {
    if (el.inert) continue
    el.inert = true
    inertByStack.add(el)
  }
}

/** После закрытия фокус — на кнопку, открывшую слой; её нет на экране — в верхний оставшийся слой */
function restoreFocus(closed: Layer): void {
  const active = document.activeElement
  if (active && active !== document.body && !closed.root.contains(active)) return // фокус уже увели — не мешаем
  const opener = closed.opener
  if (opener?.isConnected && !opener.closest('[inert]')) {
    opener.focus({ preventScroll: true })
    return
  }
  const top = stack[stack.length - 1]?.root
  top?.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]')?.focus({ preventScroll: true })
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

export interface BottomSheetOptions {
  readonly title: string
  readonly subtitle?: string
  readonly content: readonly Node[]
  /**
   * Цель аналитики шторки: крестик пишет value button, закрытие «Назад», Esc, фоном, жестом — value причины.
   * Без цели крестика нет: у каждой кнопки интерфейса есть цель
   */
  readonly tap?: UiTarget
  /** Крестик в шапке (по умолчанию — есть, если задана цель) */
  readonly closeButton?: boolean
  readonly onClose?: (reason: CloseReason) => void
}

export interface SheetHandle extends LayerHandle {
  /** Тело шторки — можно обновлять содержимое, пока она открыта */
  readonly body: HTMLElement
}

/** Нижняя шторка с любым содержимым: «Ещё», настройки, меню паузы */
export function openBottomSheet(o: BottomSheetOptions): SheetHandle {
  let handle: LayerHandle | null = null
  const close = (reason: CloseReason): void => handle?.close(reason)
  const view = sheetView({
    title: o.title,
    subtitle: o.subtitle,
    content: o.content,
    close: o.tap && o.closeButton !== false ? { label: t('common.close'), tap: { target: o.tap, value: 'button' }, onClick: () => close('button') } : null,
    onSwipeDown: () => close('swipe'),
  })
  const root = h('div', { class: 'layer layer--sheet' }, [scrim(() => close('scrim')), view.sheet])
  handle = openLayer(root, { onClose: o.onClose, tap: o.tap, focus: () => view.sheet })
  return { root: handle.root, close: handle.close, isOpen: handle.isOpen, body: view.body }
}

/** Шторка-меню из кнопок — меню паузы. tap — цель шторки (крестик и закрытие отказом) */
export function openSheet(opts: { title: string; subtitle?: string; actions: SheetAction[]; extra?: HTMLElement; tap?: UiTarget }): void {
  const actions = h(
    'div',
    { class: 'sheet__actions' },
    opts.actions.map((a) =>
      button(`btn btn--${a.variant ?? 'secondary'} btn--block`, [a.icon ? icon(a.icon) : null, h('span', { text: a.label })], a.onClick, {}, a.tap),
    ),
  )
  openBottomSheet({ title: opts.title, subtitle: opts.subtitle, tap: opts.tap, content: opts.extra ? [actions, opts.extra] : [actions] })
}

// ---------------------------------------------------------------------------
// Подтверждение
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  readonly title: string
  readonly text?: string
  /** Подпись действия: «Начать сначала», «Удалить» — глагол, а не «Да» */
  readonly confirm: string
  readonly cancel?: string
  /** Опасное действие: красная кнопка. Фокус при открытии у любого диалога — на «Отмена»: лишний Enter безопасен */
  readonly danger?: boolean
  /** Цель аналитики: кнопки пишут value confirm / cancel, закрытие «Назад», Esc, фоном — value причины */
  readonly tap?: UiTarget
}

/**
 * Диалог подтверждения. true — подтвердили; false — «Отмена», «Назад», Esc или тап по фону.
 *   if (await confirmAction({ title, confirm, danger: true, tap: 'dialog.restart' })) restart()
 */
export function confirmAction(o: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let handle: LayerHandle | null = null
    let confirmed = false
    const view = confirmView({
      title: o.title,
      text: o.text,
      confirm: o.confirm,
      cancel: o.cancel ?? t('common.cancel'),
      danger: o.danger,
      confirmTap: o.tap && { target: o.tap, value: 'confirm' },
      cancelTap: o.tap && { target: o.tap, value: 'cancel' },
      onConfirm: () => {
        if (!handle?.isOpen()) return
        confirmed = true
        handle.close('action')
      },
      onCancel: () => handle?.close('action'),
    })
    const root = h('div', { class: 'layer layer--dialog' }, [scrim(() => handle?.close('scrim')), view.box])
    handle = openLayer(root, { tap: o.tap, focus: () => view.cancel, onClose: () => resolve(confirmed) })
  })
}

/** tap — цель аналитики диалога: кнопки отправят её с value confirm / cancel, закрытие отказом — value причины */
export function confirmDialog(opts: {
  title: string
  text: string
  confirm: string
  cancel?: string
  danger?: boolean
  tap?: UiTarget
  onConfirm: () => void
}): void {
  void confirmAction(opts).then((ok) => {
    if (ok) opts.onConfirm()
  })
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
