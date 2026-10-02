/**
 * Кнопка-иконка: ⚙️ и 🔔 в хедере, «Назад» и «Меню» поверх сцены, «Закрыть» у шторки.
 *
 *   iconButton({ icon: 'bell', label: t('…'), onClick, tap: { target: 'экран.элемент' } })
 *
 * Вид (variant): plain — без подложки, для хедера и таббара; tonal — на подложке, для шторок и списков;
 * glass — полупрозрачная, поверх арта сцены. Размер (size): m — круг 40 px, s — круг 32 px.
 * Зона касания у обоих — 44×44: она больше круга, но место в раскладке занимает только круг
 * (отрицательные поля), поэтому соседям достаточно отступа от круга.
 *
 * Состояния: наведение (только мышь), нажатие, фокус с клавиатуры, недоступна (disabled),
 * включена — для кнопки-переключателя: toggle 'pressed' (режим вкл/выкл, aria-pressed) или
 * 'expanded' (открывает панель, aria-expanded). Состояние переключателя меняет вызывающий: setIconButtonActive.
 *
 * Бейдж (счётчик, точка, надпись) — в углу круга; setIconButtonBadge обновляет и бейдж, и подпись
 * для скринридера и всплывашку: «Уведомления: 3 новых». Подпись (label) — через t().
 * Аналитика — обязательный tap, как у button(). Стили — icon-button.css.
 */

import './icon-button.css'
import { button, icon, type IconName } from '../dom'
import type { Tap } from '../../tracking'
import { badge, badgeAriaLabel, setBadge, type BadgeSpec } from './badge'

export type IconButtonVariant = 'plain' | 'tonal' | 'glass'
export type IconButtonSize = 'm' | 's'
export type IconButtonToggle = 'pressed' | 'expanded'

export interface IconButtonOptions {
  readonly icon: IconName
  /** Подпись для скринридера и всплывашка — через t() */
  readonly label: string
  readonly onClick: () => void
  /** Цель аналитики (src/tracking.ts) — обязательна у каждой кнопки */
  readonly tap: Tap
  readonly variant?: IconButtonVariant
  readonly size?: IconButtonSize
  readonly badge?: BadgeSpec | null
  readonly toggle?: IconButtonToggle
  /** Начальное состояние переключателя */
  readonly active?: boolean
  readonly disabled?: boolean
}

interface Meta {
  label: string
  toggle?: IconButtonToggle
  badge: HTMLSpanElement
  spec: BadgeSpec | null
}

const meta = new WeakMap<HTMLButtonElement, Meta>()

export function iconButton(o: IconButtonOptions): HTMLButtonElement {
  const svg = icon(o.icon)
  svg.classList.add('ui-iconbtn__icon')
  const mark = badge(null)
  mark.classList.add('ui-iconbtn__badge')
  mark.setAttribute('aria-hidden', 'true')

  const btn = button(
    'ui-iconbtn',
    [svg, mark],
    o.onClick,
    {
      'data-variant': o.variant ?? 'plain',
      'data-size': o.size ?? 'm',
      disabled: o.disabled ? '' : undefined,
    },
    o.tap,
  )
  meta.set(btn, { label: o.label, toggle: o.toggle, badge: mark, spec: null })
  setIconButtonBadge(btn, o.badge ?? null)
  if (o.toggle) setIconButtonActive(btn, o.active ?? false)
  return btn
}

/** Показать, обновить или убрать бейдж (null, count: 0) — вместе с подписью для скринридера */
export function setIconButtonBadge(btn: HTMLButtonElement, spec: BadgeSpec | null): void {
  const m = meta.get(btn)
  if (!m) return
  m.spec = spec
  setBadge(m.badge, spec)
  // Всплывашка совпадает с подписью: скринридер не читает одно и то же дважды
  const label = badgeAriaLabel(m.label, spec)
  btn.setAttribute('aria-label', label)
  btn.title = label
}

/** Включить или выключить кнопку-переключатель (aria-pressed / aria-expanded по toggle) */
export function setIconButtonActive(btn: HTMLButtonElement, active: boolean): void {
  const m = meta.get(btn)
  if (!m?.toggle) return
  btn.setAttribute(m.toggle === 'pressed' ? 'aria-pressed' : 'aria-expanded', String(active))
}

export function isIconButtonActive(btn: HTMLButtonElement): boolean {
  return btn.getAttribute('aria-pressed') === 'true' || btn.getAttribute('aria-expanded') === 'true'
}
