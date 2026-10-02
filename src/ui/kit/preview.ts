/**
 * Стенд компонентов: kit.html (только dev и check:ui, в сборку игры не входит).
 * Кнопка-иконка, бейдж и чип во всех состояниях — внутри кадра каркаса, как в игре.
 * Шторка и диалог — живые: открываются через стек слоёв overlay.ts, «Назад» Telegram и Esc подключены
 * так же, как в app.ts (в Telegram — системная кнопка в шапке).
 *   /kit.html       — стенд
 *   /kit.html?hit   — сразу с подсветкой зон касания
 *
 * Наведение, нажатие и фокус на стенде «заморожены»: правила компонентов с :hover / :active /
 * :focus-visible копируются в правила с атрибутом data-pseudo. Это те же стили, что в игре, а не
 * нарисованные заново. Остальные состояния (включена, выбран, недоступна, бейдж) — настоящие атрибуты.
 * В конце каждого раздела — живой пример: там работают настоящие наведение, нажатие и клавиатура.
 *
 * Разметка для check:ui: data-row — строка образцов, data-state — состояние образца.
 * Строки стенда — служебные, мимо t() (исключение в check:ui).
 */

import '../../style.css'
import './preview.css'
import { createShell } from '../../layout/shell'
import { button, h } from '../dom'
import type { Tap } from '../../tracking'
import { badge, type BadgeSpec } from './badge'
import { iconButton, isIconButtonActive, setIconButtonActive, setIconButtonBadge, type IconButtonSize, type IconButtonVariant } from './icon-button'
import { actionChip, chip, chipGroup, filterChip, isChipSelected, setChipSelected } from './chip'
import { closeTopOverlay, confirmAction, hasOverlay, onOverlayChange, openBottomSheet, setOverlayHost, type CloseReason } from '../overlay'
import { setNativeBack } from '../../telegram'
import { isSwitchChecked, switchRow } from './switch'
import { segmented, segmentedValue, type SegmentOption } from './segmented'
import { textField, type FieldKind, type TextFieldOptions } from './text-field'

type Pseudo = 'hover' | 'active' | 'focus-visible' | 'focus-within'

const demo = (value: string): Tap => ({ target: 'kit.demo', value })
const noop = (): void => {}

// ---------------------------------------------------------------------------
// «Замороженные» состояния: копии правил компонентов с data-pseudo вместо псевдоклассов.
// Обёртка @media (hover: hover) снимается — на стенде наведение видно и на сенсорном экране.
// ---------------------------------------------------------------------------

const PSEUDO_RE = /:(hover|active|focus-visible|focus-within)(?![\w-])/g

function mirrorRules(rules: CSSRuleList, wrappers: readonly string[], out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const sel = rule.selectorText
      if (!sel.includes('.ui-') || !sel.match(PSEUDO_RE)) continue
      let css = `${sel.replace(PSEUDO_RE, '[data-pseudo~="$1"]')} { ${rule.style.cssText} }`
      for (const w of [...wrappers].reverse()) css = `${w} { ${css} }`
      out.push(css)
    } else if (rule instanceof CSSSupportsRule) {
      mirrorRules(rule.cssRules, [...wrappers, `@supports ${rule.conditionText}`], out)
    } else if (rule instanceof CSSMediaRule) {
      const input = /hover|pointer/.test(rule.conditionText)
      mirrorRules(rule.cssRules, input ? wrappers : [...wrappers, `@media ${rule.conditionText}`], out)
    }
  }
}

function mirrorPseudoStates(): number {
  const out: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      mirrorRules(sheet.cssRules, [], out)
    } catch {
      // чужой домен — правила недоступны, у компонентов таких нет
    }
  }
  document.head.append(h('style', { 'data-kit': 'pseudo-states', text: out.join('\n') }))
  return out.length
}

// ---------------------------------------------------------------------------
// Разметка стенда
// ---------------------------------------------------------------------------

function spec(caption: string, el: HTMLElement, state: string, pseudo?: Pseudo, wide = false): HTMLElement {
  if (pseudo) el.dataset.pseudo = pseudo
  return h('figure', { class: `kit-spec${wide ? ' kit-spec--wide' : ''}`, 'data-state': state }, [
    h('div', { class: 'kit-spec__stage' }, [el]),
    h('figcaption', { class: 'kit-spec__caption', text: caption }),
  ])
}

function row(id: string, title: string, items: HTMLElement[], extraClass = ''): HTMLElement {
  return h('div', { class: 'kit-row', 'data-row': id }, [
    h('p', { class: 'kit-row__title', text: title }),
    h('div', { class: `kit-grid${extraClass ? ` ${extraClass}` : ''}` }, items),
  ])
}

function section(id: string, title: string, note: string, children: HTMLElement[]): HTMLElement {
  return h('section', { class: 'kit-section', 'data-section': id }, [
    h('h2', { class: 'kit-section__title', text: title }),
    h('p', { class: 'kit-section__note', text: note }),
    ...children,
  ])
}

const hidden = (): HTMLElement => h('span', { class: 'kit-empty', text: 'скрыт' })

// ---------------------------------------------------------------------------
// Кнопка-иконка
// ---------------------------------------------------------------------------

const ICON_STATES: readonly { id: string; caption: string; pseudo?: Pseudo }[] = [
  { id: 'default', caption: 'обычная' },
  { id: 'hover', caption: 'наведение', pseudo: 'hover' },
  { id: 'active', caption: 'нажатие', pseudo: 'active' },
  { id: 'focus', caption: 'фокус', pseudo: 'focus-visible' },
  { id: 'on', caption: 'включена' },
  { id: 'disabled', caption: 'недоступна' },
]

function iconStates(variant: IconButtonVariant, size: IconButtonSize): HTMLElement[] {
  return ICON_STATES.map((s) =>
    spec(
      s.caption,
      iconButton({
        icon: variant === 'glass' ? 'menu' : 'bell',
        label: 'Пример',
        onClick: noop,
        tap: demo(`iconbtn.${variant}.${size}.${s.id}`),
        variant,
        size,
        toggle: 'pressed',
        active: s.id === 'on',
        disabled: s.id === 'disabled',
      }),
      s.id,
      s.pseudo,
    ),
  )
}

const BADGE_CASES: readonly { id: string; caption: string; spec: BadgeSpec }[] = [
  { id: 'dot', caption: 'точка', spec: { dot: true } },
  { id: 'count-1', caption: '1', spec: { count: 1 } },
  { id: 'count-12', caption: '12', spec: { count: 12 } },
  { id: 'overflow', caption: '120 → 99+', spec: { count: 120 } },
  { id: 'label', caption: 'надпись', spec: { label: 'Новое' } },
  { id: 'alert', caption: 'срочное', spec: { count: 5, tone: 'alert' } },
  { id: 'zero', caption: '0 — скрыт', spec: { count: 0 } },
]

function iconBadges(variant: IconButtonVariant, size: IconButtonSize): HTMLElement[] {
  return BADGE_CASES.map((b) =>
    spec(
      b.caption,
      iconButton({ icon: 'bell', label: 'Уведомления', onClick: noop, tap: demo(`iconbtn.badge.${b.id}`), variant, size, badge: b.spec }),
      b.id,
    ),
  )
}

function iconLive(): HTMLElement {
  let unread = 3
  const readout = h('p', { class: 'kit-readout', 'data-live': 'iconbtn' })
  const render = (): void => {
    readout.textContent = `Непрочитанных: ${unread} · панель ${isIconButtonActive(bell) ? 'открыта' : 'закрыта'} · крупный текст: ${isIconButtonActive(big) ? 'вкл' : 'выкл'}`
  }
  const bell: HTMLButtonElement = iconButton({
    icon: 'bell',
    label: 'Уведомления',
    tap: demo('live.bell'),
    toggle: 'expanded',
    badge: { count: unread },
    onClick: () => {
      const open = !isIconButtonActive(bell)
      setIconButtonActive(bell, open)
      if (open) unread = 0 // открыли панель — прочитано
      setIconButtonBadge(bell, { count: unread })
      render()
    },
  })
  const big: HTMLButtonElement = iconButton({
    icon: 'text',
    label: 'Крупный текст',
    tap: demo('live.textSize'),
    variant: 'tonal',
    toggle: 'pressed',
    onClick: () => {
      setIconButtonActive(big, !isIconButtonActive(big))
      render()
    },
  })
  const add = actionChip({
    text: 'Новое уведомление',
    icon: 'bell',
    tap: demo('live.addNotice'),
    onClick: () => {
      unread += 1
      setIconButtonBadge(bell, { count: unread })
      render()
    },
  })
  render()
  return h('div', { class: 'kit-live', 'data-live-box': 'iconbtn' }, [bell, big, add, readout])
}

function headerMock(): HTMLElement {
  return h('div', { class: 'kit-mock-header', 'data-row': 'iconbtn-header' }, [
    h('span', { class: 'kit-mock-header__title', text: 'Личные дела' }),
    iconButton({ icon: 'settings', label: 'Настройки', onClick: noop, tap: demo('header.settings') }),
    iconButton({ icon: 'bell', label: 'Уведомления', onClick: noop, tap: demo('header.bell'), badge: { count: 3 } }),
  ])
}

const iconSection = section('iconbtn', 'Кнопка-иконка', 'Видно круг 40 или 32 px, нажимается квадрат 44×44. Наведение — только мышью.', [
  row('iconbtn-plain-m', 'plain · 40 — хедер, таббар', iconStates('plain', 'm')),
  row('iconbtn-tonal-m', 'tonal · 40 — шторки, списки', iconStates('tonal', 'm')),
  row('iconbtn-glass-m', 'glass · 40 — поверх арта', iconStates('glass', 'm'), 'kit-grid--art'),
  row('iconbtn-plain-s', 'plain · 32', iconStates('plain', 's')),
  row('iconbtn-tonal-s', 'tonal · 32 — «закрыть» у шторки', iconStates('tonal', 's')),
  row('iconbtn-badge-m', 'с бейджем · 40', iconBadges('plain', 'm')),
  row('iconbtn-badge-s', 'с бейджем · 32', iconBadges('tonal', 's')),
  h('p', { class: 'kit-row__title', text: 'в хедере — пример шага 4.1' }),
  headerMock(),
  h('p', { class: 'kit-row__title', text: 'живой пример' }),
  iconLive(),
])

// ---------------------------------------------------------------------------
// Бейдж
// ---------------------------------------------------------------------------

const badgeSection = section('badge', 'Бейдж', 'Счётчик, точка «есть новое», короткая надпись. 0 — не показывается.', [
  row('badge-count', 'счётчик', [
    spec('1', badge({ count: 1 }), 'count-1'),
    spec('9', badge({ count: 9 }), 'count-9'),
    spec('12', badge({ count: 12 }), 'count-12'),
    spec('99', badge({ count: 99 }), 'count-99'),
    spec('100 → 99+', badge({ count: 100 }), 'overflow'),
    spec('0', h('span', { class: 'kit-zero' }, [badge({ count: 0 }), hidden()]), 'zero'),
  ]),
  row('badge-tone', 'тон и вид', [
    spec('accent', badge({ count: 3 }), 'accent'),
    spec('alert', badge({ count: 3, tone: 'alert' }), 'alert'),
    spec('neutral', badge({ count: 3, tone: 'neutral' }), 'neutral'),
    spec('точка', badge({ dot: true }), 'dot'),
    spec('точка alert', badge({ dot: true, tone: 'alert' }), 'dot-alert'),
    spec('надпись', badge({ label: 'Новое' }), 'label'),
    spec('надпись neutral', badge({ label: 'Скоро', tone: 'neutral' }), 'label-neutral'),
  ]),
  row(
    'badge-ring',
    'обводка цветом подложки',
    (['bg', 'surface', 'sheet'] as const).map((s) =>
      h('div', { class: `kit-spec kit-surface--${s}`, 'data-state': s }, [
        h('div', { class: 'kit-spec__stage' }, [
          iconButton({ icon: 'bell', label: 'Уведомления', onClick: noop, tap: demo(`badge.ring.${s}`), badge: { count: 3 } }),
        ]),
        h('p', { class: 'kit-spec__caption', text: `--${s}` }),
      ]),
    ),
  ),
  h('p', { class: 'kit-row__title', text: 'рядом с текстом' }),
  h('div', { class: 'kit-list', 'data-row': 'badge-inline' }, [
    h('div', { class: 'kit-list__row' }, [h('span', { text: 'Уведомления' }), badge({ count: 3 })]),
    h('div', { class: 'kit-list__row' }, [h('span', { text: 'Магазин' }), badge({ label: 'Новое' })]),
    h('div', { class: 'kit-list__row' }, [h('span', { text: 'Сообщества' }), badge({ dot: true })]),
  ]),
])

// ---------------------------------------------------------------------------
// Чип
// ---------------------------------------------------------------------------

const CHIP_STATES: readonly { id: string; caption: string; pseudo?: Pseudo; selected?: boolean; disabled?: boolean }[] = [
  { id: 'default', caption: 'обычный' },
  { id: 'hover', caption: 'наведение', pseudo: 'hover' },
  { id: 'active', caption: 'нажатие', pseudo: 'active' },
  { id: 'focus', caption: 'фокус', pseudo: 'focus-visible' },
  { id: 'on', caption: 'выбран', selected: true },
  { id: 'on-hover', caption: 'выбран + наведение', pseudo: 'hover', selected: true },
  { id: 'disabled', caption: 'недоступен', disabled: true },
]

function chipLive(): HTMLElement {
  const readout = h('p', { class: 'kit-readout', 'data-live': 'chip' })
  const genres = ['Детектив', 'Мистика', 'Драма', 'Романтика', 'Триллер', 'Комедия']
  const render = (): void => {
    const picked = chips.filter(isChipSelected).map((c) => c.textContent ?? '')
    readout.textContent = picked.length ? `Выбрано: ${picked.join(', ')}` : 'Ничего не выбрано'
  }
  const chips = genres.map((g, i) => filterChip({ text: g, selected: i === 0, onChange: render, tap: demo(`live.genre.${i}`) }))
  const reset = actionChip({
    text: 'Сбросить',
    icon: 'restart',
    tap: demo('live.reset'),
    onClick: () => {
      for (const c of chips) setChipSelected(c, false)
      render()
    },
  })
  render()
  return h('div', { class: 'kit-live', 'data-live-box': 'chip' }, [chipGroup('Жанр', [...chips, reset]), readout])
}

const chipSection = section('chip', 'Чип', 'Метка, действие и фильтр. Видна «пилюля» 32 px, нажимается полоса 44 px.', [
  row('chip-static', 'метка — без нажатия', [
    spec('текст', chip({ text: 'Детектив' }), 'text'),
    spec('коротко', chip({ text: '18+' }), 'short'),
    spec('с иконкой', chip({ text: 'Сезон 1', icon: 'book' }), 'icon'),
    spec('со счётчиком', chip({ text: 'Эпизоды', count: 8 }), 'count'),
  ], 'kit-grid--wide'),
  row(
    'chip-action',
    'действие',
    CHIP_STATES.filter((s) => !s.selected).map((s) =>
      spec(s.caption, actionChip({ text: '120', icon: 'star', onClick: noop, tap: demo(`chip.action.${s.id}`), disabled: s.disabled }), s.id, s.pseudo),
    ),
    'kit-grid--wide',
  ),
  row(
    'chip-filter',
    'фильтр',
    CHIP_STATES.map((s) =>
      spec(
        s.caption,
        filterChip({ text: 'Мистика', selected: !!s.selected, onChange: noop, tap: demo(`chip.filter.${s.id}`), disabled: s.disabled }),
        s.id,
        s.pseudo,
      ),
    ),
    'kit-grid--wide',
  ),
  row('chip-extra', 'счётчик и длинный текст', [
    spec('счётчик', filterChip({ text: 'Прочитано', count: 3, selected: false, onChange: noop, tap: demo('chip.count.off') }), 'count-off', undefined, true),
    spec('выбран, счётчик', filterChip({ text: 'Прочитано', count: 3, selected: true, onChange: noop, tap: demo('chip.count.on') }), 'count-on', undefined, true),
    spec(
      'длинный — многоточие',
      h('div', { class: 'kit-narrow' }, [
        filterChip({ text: 'Очень длинное название фильтра, которое не влезает', icon: 'book', selected: false, onChange: noop, tap: demo('chip.long') }),
      ]),
      'long',
      undefined,
      true,
    ),
  ], 'kit-grid--wide'),
  h('p', { class: 'kit-row__title', text: 'живой пример — группа фильтров' }),
  chipLive(),
])

// ---------------------------------------------------------------------------
// Шторка и диалог (шаг 2.2): открываются по-настоящему, через стек слоёв overlay.ts
// ---------------------------------------------------------------------------

const REASONS: Record<CloseReason, string> = {
  back: '«Назад»',
  esc: 'Esc',
  scrim: 'тап по фону',
  swipe: 'жест вниз',
  button: 'крестик',
  action: 'кнопка внутри',
  nav: 'переход',
}

function overlayLive(): HTMLElement {
  const readout = h('p', { class: 'kit-readout', 'data-live': 'overlay', text: 'Ещё ничего не открывали' })
  const say = (text: string): void => {
    readout.textContent = text
  }
  const closed = (name: string) => (reason: CloseReason) => say(`Шторка «${name}» закрыта: ${REASONS[reason]} (${reason})`)
  const ask = async (danger: boolean): Promise<boolean> => {
    const ok = await confirmAction({
      title: danger ? 'Начать эпизод сначала?' : 'Перечитать эпизод?',
      text: danger ? 'Выборы этого эпизода сбросятся. Прочитанное в прошлых эпизодах сохранится.' : 'Прогресс сезона до этого эпизода сохранится.',
      confirm: danger ? 'Начать сначала' : 'Перечитать',
      danger,
      tap: 'kit.demo',
    })
    say(`Диалог: ${ok ? 'подтвердили' : 'не подтвердили'}`)
    return ok
  }

  const menu = (): void => {
    let toStory = 0 // сколько раз сработала «К истории»: двойной тап должен засчитаться один раз
    const sheet = openBottomSheet({
      title: 'Намертво',
      subtitle: 'Эпизод 1 · 35%',
      tap: 'kit.demo',
      onClose: closed('меню'),
      content: [
        h('div', { class: 'sheet__actions' }, [
          button('btn btn--primary btn--block', 'Продолжить чтение', () => sheet.close(), {}, demo('sheet.continue')),
          button(
            'btn btn--secondary btn--block',
            'К истории',
            () => {
              toStory += 1
              sheet.close()
              say(`«К истории» сработала: ${toStory}`)
            },
            { 'data-open': 'to-story' },
            demo('sheet.toStory'),
          ),
          button(
            'btn btn--danger btn--block',
            'Начать эпизод сначала',
            () => {
              void ask(true).then((ok) => ok && sheet.close())
            },
            { 'data-open': 'nested' },
            demo('sheet.restart'),
          ),
        ]),
      ],
    })
  }
  const long = (): void => {
    openBottomSheet({
      title: 'Длинная шторка',
      subtitle: 'Шапка на месте, тело прокручивается',
      tap: 'kit.demo',
      onClose: closed('длинная'),
      content: [
        h(
          'div',
          { class: 'kit-list' },
          Array.from({ length: 24 }, (_, i) => h('div', { class: 'kit-list__row', 'data-row-n': String(i + 1) }, [h('span', { text: `Настройка ${i + 1}` })])),
        ),
      ],
    })
  }
  const plain = (): void => {
    openBottomSheet({
      title: 'Без крестика',
      tap: 'kit.demo',
      closeButton: false,
      onClose: closed('без крестика'),
      content: [h('p', { class: 'kit-intro', text: 'Закрывается «Назад», Esc, тапом по фону или жестом вниз.' })],
    })
  }

  const open = (id: string, text: string, onClick: () => void): HTMLElement => {
    const el = actionChip({ text, onClick, tap: demo(`open.${id}`) })
    el.dataset.open = id
    return el
  }
  return h('div', { class: 'kit-live', 'data-live-box': 'overlay' }, [
    chipGroup('Открыть', [
      open('menu', 'Меню паузы', menu),
      open('long', 'Длинная шторка', long),
      open('plain', 'Без крестика', plain),
      open('dialog', 'Диалог', () => void ask(false)),
      open('danger', 'Опасный диалог', () => void ask(true)),
    ]),
    readout,
  ])
}

const overlaySection = section(
  'overlay',
  'Шторка и диалог',
  'Закрываются «Назад» Telegram, Esc, тапом по фону, крестиком; шторка — ещё жестом вниз за шапку. Сначала закрывается верхний слой.',
  [overlayLive()],
)

// ---------------------------------------------------------------------------
// Переключатель и сегменты (шаг 2.3)
// ---------------------------------------------------------------------------

/** Состояние образца на элементе внутри компонента (сегмент, рамка поля), а не на нём самом */
function pseudoOn(el: HTMLElement, selector: string, pseudo: Pseudo): HTMLElement {
  const inner = el.querySelector<HTMLElement>(selector)
  if (inner) inner.dataset.pseudo = pseudo
  return el
}

const SWITCH_STATES: readonly { id: string; caption: string; checked: boolean; pseudo?: Pseudo; disabled?: boolean }[] = [
  { id: 'off', caption: 'выключен', checked: false },
  { id: 'on', caption: 'включён', checked: true },
  { id: 'hover', caption: 'наведение', checked: false, pseudo: 'hover' },
  { id: 'active', caption: 'нажатие', checked: true, pseudo: 'active' },
  { id: 'focus', caption: 'фокус', checked: false, pseudo: 'focus-visible' },
  { id: 'disabled-off', caption: 'недоступен, выключен', checked: false, disabled: true },
  { id: 'disabled-on', caption: 'недоступен, включён', checked: true, disabled: true },
]

const THEMES: readonly SegmentOption[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'auto', label: 'Как в Telegram' },
]
const SIZES: readonly SegmentOption[] = [
  { value: 's', label: 'Мельче', glyph: 'А', glyphSize: 15 },
  { value: 'm', label: 'Обычный', glyph: 'А', glyphSize: 19 },
  { value: 'l', label: 'Крупнее', glyph: 'А', glyphSize: 24 },
]

const seg = (options: readonly SegmentOption[], value: string, disabled = false): HTMLDivElement =>
  segmented({ label: 'Пример', options, value, onChange: noop, tap: 'kit.demo', disabled })

function controlsLive(): HTMLElement {
  const readout = h('p', { class: 'kit-readout', 'data-live': 'controls' })
  const switches = [
    switchRow({ label: 'Звук', checked: true, onChange: () => render(), tap: 'kit.demo' }),
    switchRow({ label: 'Музыка', hint: 'Фоновая мелодия в эпизодах', checked: false, onChange: () => render(), tap: 'kit.demo' }),
    switchRow({ label: 'Вибрация', checked: true, onChange: () => render(), tap: 'kit.demo', disabled: false }),
  ]
  const theme = segmented({ label: 'Тема', options: THEMES, value: 'dark', onChange: () => render(), tap: 'kit.demo' })
  const render = (): void => {
    const on = switches.filter(isSwitchChecked).map((sw) => sw.querySelector('.ui-switch__label')?.textContent ?? '')
    readout.textContent = `Включено: ${on.join(', ') || 'ничего'} · тема: ${segmentedValue(theme)}`
  }
  render()
  return h('div', { class: 'kit-live kit-live--column', 'data-live-box': 'controls' }, [h('div', { class: 'kit-stack' }, switches), theme, readout])
}

const controlsSection = section('controls', 'Переключатель и сегменты', 'Переключатель нажимается всей строкой. Сегменты — стрелками клавиатуры, в порядке Tab только выбранный.', [
  row(
    'switch-states',
    'переключатель',
    SWITCH_STATES.map((st) => {
      const sw = switchRow({ label: 'Звук в эпизодах', checked: st.checked, onChange: noop, tap: 'kit.demo', disabled: st.disabled })
      if (st.pseudo) sw.dataset.pseudo = st.pseudo
      return spec(st.caption, sw, st.id)
    }),
    'kit-grid--rows',
  ),
  row(
    'switch-extra',
    'с пояснением и длинной подписью',
    [
      spec(
        'пояснение',
        switchRow({ label: 'Уведомления о новых эпизодах', hint: 'Бот напишет, когда выйдет следующая глава', checked: true, onChange: noop, tap: 'kit.demo' }),
        'hint',
      ),
    ],
    'kit-grid--rows',
  ),
  row(
    'seg-states',
    'сегменты',
    [
      spec('выбран первый', seg(THEMES, 'dark'), 'default'),
      spec('наведение на другой', pseudoOn(seg(THEMES, 'dark'), '[data-value="light"]', 'hover'), 'hover'),
      spec('нажатие', pseudoOn(seg(THEMES, 'dark'), '[data-value="light"]', 'active'), 'active'),
      spec('фокус с клавиатуры', pseudoOn(seg(THEMES, 'light'), '[data-value="light"]', 'focus-visible'), 'focus'),
      spec('выбран последний', seg(THEMES, 'auto'), 'last'),
      spec('ничего не выбрано', seg(THEMES, ''), 'empty'),
      spec(
        'вариант недоступен',
        segmented({ label: 'Пример', options: [THEMES[0], { ...THEMES[1], disabled: true }, THEMES[2]], value: 'dark', onChange: noop, tap: 'kit.demo' }),
        'option-disabled',
      ),
      spec('вся группа недоступна', seg(THEMES, 'dark', true), 'disabled'),
      spec('со знаком — размер текста', seg(SIZES, 'm'), 'glyph'),
      spec('два варианта', seg([{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }], 'ru'), 'two'),
    ],
    'kit-grid--rows',
  ),
  h('p', { class: 'kit-row__title', text: 'живой пример — настройки' }),
  controlsLive(),
])

// ---------------------------------------------------------------------------
// Поле ввода (шаг 2.3): состояния, виды клавиатуры, форма внизу экрана и промокод в шторке
// ---------------------------------------------------------------------------

function field(o: TextFieldOptions, mark?: string): ReturnType<typeof textField> {
  const f = textField(o)
  if (mark) f.root.dataset.field = mark
  return f
}

function fieldStates(): HTMLElement[] {
  const filled = field({ label: 'Имя в истории', value: 'Вера', hint: 'Так к тебе будут обращаться герои', clear: 'kit.demo' })
  const error = field({ label: 'Промокод', kind: 'code', value: 'NAMERTV', maxLength: 16, counter: true })
  error.setError('Такого промокода нет — проверь буквы')
  const errorFocus = field({ label: 'Промокод', kind: 'code', value: 'NAMERTV' })
  errorFocus.setError('Такого промокода нет — проверь буквы')
  return [
    spec('пустое, с примером', field({ label: 'Имя в истории', placeholder: 'Например, Вера', hint: 'Так к тебе будут обращаться герои' }).root, 'empty'),
    spec('заполнено, с крестиком', filled.root, 'filled'),
    spec('наведение', pseudoOn(field({ label: 'Имя в истории', placeholder: 'Например, Вера' }).root, '.ui-field__box', 'hover'), 'hover'),
    spec('фокус', pseudoOn(field({ label: 'Имя в истории', value: 'Вера' }).root, '.ui-field__box', 'focus-within'), 'focus'),
    spec('ошибка', error.root, 'error'),
    spec('ошибка, фокус', pseudoOn(errorFocus.root, '.ui-field__box', 'focus-within'), 'error-focus'),
    spec('счётчик', field({ label: 'Промокод', kind: 'code', value: 'NAMERTVO', maxLength: 16, counter: true }).root, 'counter'),
    spec('только чтение', field({ label: 'ID игрока', value: '48 151 623', readOnly: true }).root, 'readonly'),
    spec('недоступно', field({ label: 'Почта', kind: 'email', placeholder: 'name@mail.ru', disabled: true }).root, 'disabled'),
  ]
}

const KIND_SAMPLES: readonly { kind: FieldKind; caption: string; label: string; placeholder: string }[] = [
  { kind: 'code', caption: 'код: заглавные, без автозамены', label: 'Промокод', placeholder: 'NAMERTVO-2026' },
  { kind: 'number', caption: 'цифры: цифровая клавиатура', label: 'Год рождения героя', placeholder: '1987' },
  { kind: 'email', caption: 'почта: клавиатура с @', label: 'Почта', placeholder: 'name@mail.ru' },
  { kind: 'search', caption: 'поиск: кнопка «Найти»', label: 'Поиск по архиву', placeholder: 'Название дела' },
]

/** Промокод: пусто или короче 4 символов — ошибка; иначе — «принят» (стенд, сервера нет) */
function checkPromo(value: string): string | null {
  if (!value) return 'Введи промокод'
  if (value.length < 4) return 'Промокод — от 4 символов'
  return null
}

function fieldLive(): HTMLElement {
  const readout = h('p', { class: 'kit-readout', 'data-live': 'field', text: 'Ещё ничего не отправляли' })
  const say = (text: string): void => {
    readout.textContent = text
  }
  const name = field({ label: 'Имя в истории', placeholder: 'Например, Вера', enterKeyHint: 'next', clear: 'kit.demo' }, 'name')
  const email = field({ label: 'Почта', kind: 'email', placeholder: 'name@mail.ru', enterKeyHint: 'next' }, 'email')
  const year = field({ label: 'Год рождения героя', kind: 'number', placeholder: '1987', maxLength: 4 }, 'number')
  const promo = field(
    {
      label: 'Промокод',
      kind: 'code',
      placeholder: 'NAMERTVO-2026',
      hint: 'Последнее поле внизу экрана — клавиатура не должна его закрыть',
      maxLength: 16,
      counter: true,
      clear: 'kit.demo',
      onSubmit: (v) => {
        const err = checkPromo(v)
        promo.setError(err)
        if (!err) say(`Промокод ${v} отправлен`)
      },
    },
    'promo',
  )
  name.input.addEventListener('keydown', (e) => e.key === 'Enter' && email.focus())
  email.input.addEventListener('keydown', (e) => e.key === 'Enter' && year.focus())

  const openPromoSheet = (): void => {
    const code = field(
      {
        label: 'Промокод',
        kind: 'code',
        placeholder: 'NAMERTVO-2026',
        hint: 'Промокод из канала или от друзей',
        maxLength: 16,
        counter: true,
        clear: 'kit.demo',
        onSubmit: () => apply(),
      },
      'sheet-promo',
    )
    const apply = (): void => {
      const err = checkPromo(code.value())
      code.setError(err)
      if (err) return
      say(`Промокод ${code.value()} отправлен из шторки`)
      sheet.close()
    }
    const sheet = openBottomSheet({
      title: 'Промокод',
      subtitle: 'Шторка поднимается над клавиатурой',
      tap: 'kit.demo',
      content: [h('div', { class: 'kit-stack' }, [code.root, button('btn btn--primary btn--block', 'Применить', apply, { 'data-field-submit': 'sheet' }, demo('field.apply'))])],
    })
  }
  const promoSheet = actionChip({ text: 'Промокод в шторке', onClick: openPromoSheet, tap: demo('open.promo') })
  promoSheet.dataset.open = 'promo'

  return h('div', { class: 'kit-live kit-live--column', 'data-live-box': 'field' }, [
    chipGroup('Открыть', [promoSheet]),
    h('div', { class: 'kit-stack' }, [name.root, email.root, year.root, promo.root]),
    readout,
  ])
}

const fieldSection = section('field', 'Поле ввода', 'Подпись сверху, шрифт 16 px, подсказка или ошибка снизу. Клавиатура поднимает кадр, поле докручивается на виду.', [
  row('field-states', 'состояния', fieldStates(), 'kit-grid--rows'),
  row(
    'field-kinds',
    'вид поля → своя клавиатура',
    KIND_SAMPLES.map((k) => spec(k.caption, field({ label: k.label, kind: k.kind, placeholder: k.placeholder }, `kind-${k.kind}`).root, k.kind)),
    'kit-grid--rows',
  ),
  h('p', { class: 'kit-row__title', text: 'живой пример — форма внизу экрана' }),
  fieldLive(),
])

// ---------------------------------------------------------------------------
// Сборка
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search)
const shell = createShell(document.getElementById('app')!)
shell.header.append(h('span', { class: 'kit-title', text: 'Компоненты · шаги 2.1–2.3' }))

// Слои — в кадр, «Назад» Telegram и Esc закрывают верхний слой: так же, как в app.ts
setOverlayHost(shell.root)
onOverlayChange(() => setNativeBack(hasOverlay() ? () => closeTopOverlay('back') : null))
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeTopOverlay('esc')
})

const hitToggle = filterChip({
  text: 'Зоны касания 44 px',
  selected: params.has('hit'),
  tap: demo('stand.hit'),
  onChange: (on) => {
    if (on) shell.root.dataset.kitHit = ''
    else delete shell.root.dataset.kitHit
  },
})
if (params.has('hit')) shell.root.dataset.kitHit = ''

shell.content.append(
  h('div', { class: 'app-page kit-page' }, [
    h('p', { class: 'kit-intro', text: 'Наведение, нажатие и фокус заморожены — это стили компонентов как в игре. Живые примеры — в конце разделов.' }),
    h('div', { class: 'kit-controls' }, [hitToggle]),
    iconSection,
    badgeSection,
    chipSection,
    overlaySection,
    controlsSection,
    fieldSection,
  ]),
)

const mirrored = mirrorPseudoStates()
document.documentElement.dataset.kitReady = String(mirrored)
