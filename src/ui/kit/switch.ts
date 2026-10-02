/**
 * Переключатель — строка настройки: подпись (и пояснение) слева, «рычажок» справа.
 *
 *   switchRow({ label: t('…'), hint: t('…'), checked, onChange, tap: 'settings.sound' })
 *
 * Нажимается вся строка (высота от 56 px), а не только рычажок. role="switch" + aria-checked:
 * скринридер говорит «включено / выключено»; имя — подпись, пояснение — описание (aria-describedby).
 * Переключается сам и сообщает новое состояние; аналитика — ui_tap с value on / off (каким стал).
 * Включён — латунный, рычажок справа: состояние видно и формой, не только цветом. Стили — switch.css.
 */

import './switch.css'
import { button, h } from '../dom'
import type { UiTarget } from '../../tracking'

export interface SwitchOptions {
  readonly label: string
  readonly hint?: string
  readonly checked: boolean
  /** Вызывается после переключения — с новым состоянием */
  readonly onChange: (checked: boolean) => void
  /** Цель аналитики; value — on / off, каким переключатель стал */
  readonly tap: UiTarget
  readonly disabled?: boolean
}

let seq = 0

export function switchRow(o: SwitchOptions): HTMLButtonElement {
  const id = `ui-switch-${++seq}`
  const el: HTMLButtonElement = button(
    'ui-switch',
    [
      h('span', { class: 'ui-switch__text' }, [
        h('span', { class: 'ui-switch__label', id: `${id}-label`, text: o.label }),
        o.hint ? h('span', { class: 'ui-switch__hint', id: `${id}-hint`, text: o.hint }) : null,
      ]),
      h('span', { class: 'ui-switch__track', 'aria-hidden': 'true' }, [h('span', { class: 'ui-switch__thumb' })]),
    ],
    () => {
      const next = !isSwitchChecked(el)
      setSwitchChecked(el, next)
      o.onChange(next)
    },
    {
      role: 'switch',
      'aria-checked': String(o.checked),
      'aria-labelledby': `${id}-label`,
      'aria-describedby': o.hint ? `${id}-hint` : undefined,
      disabled: o.disabled ? '' : undefined,
    },
    { target: o.tap, value: () => (isSwitchChecked(el) ? 'off' : 'on') },
  )
  return el
}

export function isSwitchChecked(el: HTMLElement): boolean {
  return el.getAttribute('aria-checked') === 'true'
}

/** Включить или выключить снаружи (состояние из store) — onChange не вызывается */
export function setSwitchChecked(el: HTMLElement, checked: boolean): void {
  el.setAttribute('aria-checked', String(checked))
}
