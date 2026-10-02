/**
 * Бейдж — маленький индикатор на кнопке, вкладке или рядом с текстом.
 *
 *   badge({ count: 3 })              — счётчик; 0 и меньше — бейдж скрыт; больше max (99) — «99+»
 *   badge({ dot: true })             — «есть новое» без числа
 *   badge({ label: t('…') })         — короткая надпись («Новое»); текст передаёт вызывающий, через t()
 *   badge(null)                      — скрыт
 *   tone: accent — латунь, по умолчанию; alert — срочное; neutral — спокойный счётчик (в чипе, в списке)
 *
 * Значение меняется через setBadge(el, spec) — бейдж сам прячется и показывается.
 * Смысл бейджа на кнопке для скринридера несёт подпись кнопки (badgeAriaLabel), сам бейдж там скрыт.
 * Отдельно стоящая точка читается как «Есть новое». Стили — badge.css.
 */

import './badge.css'
import { h } from '../dom'
import { t } from '../../i18n'

export type BadgeTone = 'accent' | 'alert' | 'neutral'

export type BadgeSpec =
  | { readonly count: number; readonly max?: number; readonly tone?: BadgeTone }
  | { readonly dot: true; readonly tone?: BadgeTone }
  | { readonly label: string; readonly tone?: BadgeTone }

/** Больше этого счётчик не показывает: «99+» */
export const BADGE_MAX = 99

/** Бейдж виден: есть что показать */
export function isBadgeShown(spec: BadgeSpec | null | undefined): spec is BadgeSpec {
  if (!spec) return false
  if ('count' in spec) return Number.isFinite(spec.count) && spec.count >= 1
  if ('dot' in spec) return spec.dot
  return spec.label.trim() !== ''
}

/** Текст счётчика: 7 → «7», 120 → «99+» */
export function badgeCountText(count: number, max = BADGE_MAX): string {
  const n = Math.floor(count)
  return n > max ? t('kit.badgeOverflow', { max }) : String(n)
}

export function badge(spec: BadgeSpec | null): HTMLSpanElement {
  const el = h('span', { class: 'ui-badge' })
  setBadge(el, spec)
  return el
}

export function setBadge(el: HTMLElement, spec: BadgeSpec | null): void {
  if (!isBadgeShown(spec)) {
    el.hidden = true
    el.dataset.kind = 'none'
    el.replaceChildren()
    return
  }
  el.hidden = false
  el.dataset.tone = spec.tone ?? 'accent'
  if ('count' in spec) {
    el.dataset.kind = 'count'
    el.textContent = badgeCountText(spec.count, spec.max)
  } else if ('dot' in spec) {
    el.dataset.kind = 'dot'
    el.replaceChildren(h('span', { class: 'ui-badge__sr', text: t('kit.badgeDot') }))
  } else {
    el.dataset.kind = 'label'
    el.textContent = spec.label
  }
}

/**
 * Подпись элемента вместе с бейджем — для aria-label кнопки, на которой бейдж сидит:
 * «Уведомления» + { count: 3 } → «Уведомления: 3 новых». Скринридер слышит настоящее число, даже если видно «99+».
 */
export function badgeAriaLabel(label: string, spec: BadgeSpec | null | undefined): string {
  if (!isBadgeShown(spec)) return label
  if ('count' in spec) return t('kit.a11yCount', { label, count: Math.floor(spec.count) })
  if ('dot' in spec) return t('kit.a11yDot', { label })
  return t('kit.a11yLabel', { label, badge: spec.label })
}
