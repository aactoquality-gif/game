/**
 * Поле ввода: подпись сверху, поле 48 px, подсказка или ошибка под ним, счётчик символов.
 *
 *   const promo = textField({ label: t('…'), kind: 'code', maxLength: 16, counter: true, clear: 'promo.clear', onSubmit })
 *   promo.setError(t('…'))   // ошибка вместо подсказки, aria-invalid
 *
 * kind выбирает экранную клавиатуру и поведение (игроку не надо переключать раскладку):
 *   text   — обычная, с заглавной в начале предложения
 *   code   — промокод: заглавные, без автозамены и подсказок, моноширинный шрифт; value() — заглавными
 *   number — цифровая клавиатура, нецифры не вводятся
 *   email  — клавиатура с @, автозаполнение адреса
 *   search — клавиатура с кнопкой «Найти»
 * Шрифт 16 px: при меньшем iOS приближает страницу при фокусе.
 * Клавиатура не закрывает поле: кадр встаёт над ней, а блок поля (вместе с подписью и подсказкой —
 * его scroll-margin) докручивается на виду — это делает каркас (src/layout/keyboard.ts) для любого поля.
 * Текст ввода — не через t(): это данные игрока. Подписи — через t(). Стили — text-field.css.
 */

import './text-field.css'
import { h } from '../dom'
import { t } from '../../i18n'
import type { UiTarget } from '../../tracking'
import { iconButton } from './icon-button'

export type FieldKind = 'text' | 'code' | 'number' | 'email' | 'search'
export type EnterKeyHint = 'done' | 'go' | 'next' | 'send' | 'search'

export interface TextFieldOptions {
  readonly label: string
  readonly kind?: FieldKind
  readonly value?: string
  /** Пример формата («NAMERTVO-2026»), а не замена подписи */
  readonly placeholder?: string
  readonly hint?: string
  readonly maxLength?: number
  /** Счётчик «7/16» над полем справа (нужен maxLength) */
  readonly counter?: boolean
  /** Крестик «Очистить», пока поле не пустое; значение — цель аналитики (value clear) */
  readonly clear?: UiTarget
  /** Подпись кнопки Enter на экранной клавиатуре; по умолчанию — по виду поля */
  readonly enterKeyHint?: EnterKeyHint
  /** Переопределить автозаполнение: 'one-time-code', 'name'… */
  readonly autocomplete?: string
  readonly name?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly onInput?: (value: string) => void
  /** Enter или «Готово» / «Найти» на экранной клавиатуре */
  readonly onSubmit?: (value: string) => void
}

export interface TextField {
  readonly root: HTMLElement
  readonly input: HTMLInputElement
  /** Значение без пробелов по краям; у кода — заглавными */
  value(): string
  setValue(value: string): void
  /** Ошибка под полем вместо подсказки; null — убрать */
  setError(message: string | null): void
  focus(): void
}

/** Атрибуты под вид поля: какая клавиатура, автозамена, автозаполнение */
const KINDS: Record<FieldKind, Record<string, string>> = {
  text: { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true', enterkeyhint: 'done' },
  code: { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' },
  number: { type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' },
  email: { type: 'email', inputmode: 'email', autocomplete: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done' },
  search: { type: 'search', inputmode: 'search', autocomplete: 'off', enterkeyhint: 'search' },
}

let seq = 0

export function textField(o: TextFieldOptions): TextField {
  const id = `ui-field-${++seq}`
  const kind = o.kind ?? 'text'

  const input = h('input', { class: 'ui-field__input', id, name: o.name, placeholder: o.placeholder })
  for (const [key, value] of Object.entries(KINDS[kind])) input.setAttribute(key, value)
  if (o.enterKeyHint) input.setAttribute('enterkeyhint', o.enterKeyHint)
  if (o.autocomplete) input.setAttribute('autocomplete', o.autocomplete)
  if (o.maxLength) input.maxLength = o.maxLength
  input.disabled = !!o.disabled
  input.readOnly = !!o.readOnly
  input.value = o.value ?? ''

  const counter = o.counter && o.maxLength ? h('span', { class: 'ui-field__counter', 'aria-hidden': 'true' }) : null
  const hint = o.hint ? h('p', { class: 'ui-field__hint', id: `${id}-hint`, text: o.hint }) : null
  const error = h('p', { class: 'ui-field__error', id: `${id}-error`, 'aria-live': 'polite' })

  const clearBtn = o.clear
    ? iconButton({
        icon: 'close',
        label: t('common.clear'),
        variant: 'plain',
        size: 's',
        tap: { target: o.clear, value: 'clear' },
        onClick: () => {
          setValue('')
          input.focus()
          o.onInput?.('')
        },
      })
    : null
  clearBtn?.classList.add('ui-field__clear')

  const root = h('div', { class: 'ui-field', 'data-kind': kind }, [
    h('div', { class: 'ui-field__top' }, [h('label', { class: 'ui-field__label', for: id, text: o.label }), counter]),
    h('div', { class: 'ui-field__box' }, [input, clearBtn]),
    hint,
    error,
  ])

  const normalize = (v: string): string => (kind === 'number' ? v.replace(/\D+/g, '') : v)

  function sync(): void {
    if (counter && o.maxLength) counter.textContent = t('kit.fieldCounter', { count: input.value.length, max: o.maxLength })
    if (clearBtn) clearBtn.hidden = input.value === '' || input.disabled || input.readOnly
    root.dataset.filled = String(input.value !== '')
  }

  function setValue(value: string): void {
    input.value = normalize(value)
    sync()
  }

  function setError(message: string | null): void {
    error.textContent = message ?? ''
    if (message) {
      root.dataset.invalid = ''
      input.setAttribute('aria-invalid', 'true')
      input.setAttribute('aria-describedby', error.id)
    } else {
      delete root.dataset.invalid
      input.removeAttribute('aria-invalid')
      if (hint) input.setAttribute('aria-describedby', hint.id)
      else input.removeAttribute('aria-describedby')
    }
  }

  input.addEventListener('input', () => {
    const clean = normalize(input.value)
    if (clean !== input.value) input.value = clean
    if (root.dataset.invalid !== undefined) setError(null) // начали исправлять — ошибка уходит
    sync()
    o.onInput?.(input.value)
  })
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return
    event.preventDefault()
    o.onSubmit?.(value())
  })

  function value(): string {
    const v = input.value.trim()
    return kind === 'code' ? v.toUpperCase() : v
  }

  if (o.disabled) root.dataset.disabled = ''
  if (o.readOnly) root.dataset.readonly = ''
  setError(null)
  sync()

  return { root, input, value, setValue, setError, focus: () => input.focus() }
}
