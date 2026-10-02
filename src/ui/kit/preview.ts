/**
 * Стенд компонентов: kit.html (только dev и check:ui, в сборку игры не входит).
 * Кнопка-иконка, бейдж и чип во всех состояниях — внутри кадра каркаса, как в игре.
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
import { h } from '../dom'
import type { Tap } from '../../tracking'
import { badge, type BadgeSpec } from './badge'
import { iconButton, isIconButtonActive, setIconButtonActive, setIconButtonBadge, type IconButtonSize, type IconButtonVariant } from './icon-button'
import { actionChip, chip, chipGroup, filterChip, isChipSelected, setChipSelected } from './chip'

type Pseudo = 'hover' | 'active' | 'focus-visible'

const demo = (value: string): Tap => ({ target: 'kit.demo', value })
const noop = (): void => {}

// ---------------------------------------------------------------------------
// «Замороженные» состояния: копии правил компонентов с data-pseudo вместо псевдоклассов.
// Обёртка @media (hover: hover) снимается — на стенде наведение видно и на сенсорном экране.
// ---------------------------------------------------------------------------

const PSEUDO_RE = /:(hover|active|focus-visible)(?![\w-])/g

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
// Сборка
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search)
const shell = createShell(document.getElementById('app')!)
shell.header.append(h('span', { class: 'kit-title', text: 'Компоненты · шаг 2.1' }))

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
  ]),
)

const mirrored = mirrorPseudoStates()
document.documentElement.dataset.kitReady = String(mirrored)
