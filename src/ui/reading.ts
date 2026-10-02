/**
 * Экран чтения по образцу КР/7H:
 * — фон на весь экран, сверху кнопка меню (GameMenu у 7H);
 * — снизу панель текста с плашкой имени; рассказчик — без плашки;
 * — длинный текст: тап сначала докручивает панель, и только потом листает экран;
 * — выборы — стопкой по центру над панелью (DialogueSelectionMenu у 7H, ChoiceView у КР),
 *   платный выбор — золотой, с ценником;
 * — пуш «Опеки» поверх сцены и карточка конца эпизода.
 */

import type { Nav } from './nav'
import type { Scene, Choice, TextSize } from '../types'
import {
  advance,
  makeChoice,
  peekScene,
  restartEpisode,
  currentInfo,
  getStory,
  getProgress,
  getTextSize,
  setTextSize,
} from '../engine'
import { hapticSelect, hapticTap, hapticSuccess } from '../telegram'
import { h, button, icon } from './dom'
import { openSheet, confirmDialog, closeTopOverlay, hasOverlay } from './overlay'
import { t } from '../i18n'
import { segmented } from './kit/segmented'
import { iconButton } from './kit/icon-button'

/** Защита от двойного тапа: сразу после смены экрана тапы игнорируются, мс */
const TAP_GUARD_MS = 350
/** Пауза между нажатием на выбор и переходом — чтобы было видно, что выбор принят */
const PICK_DELAY_MS = 180

let renderedAt = 0
/** Что делать по Enter / пробелу / стрелке вправо (Telegram Desktop) */
let onContinue: (() => void) | null = null
/** Выборы на текущем экране — для клавиш 1–4 */
let onPick: ((i: number) => void) | null = null

document.addEventListener('keydown', (event) => {
  if (hasOverlay()) return
  if (onContinue && (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight')) {
    event.preventDefault()
    onContinue()
  } else if (onPick && /^[1-4]$/.test(event.key)) {
    onPick(Number(event.key) - 1)
  }
})

function tapAllowed(): boolean {
  return Date.now() - renderedAt >= TAP_GUARD_MS
}

export function applyTextSize(size: TextSize): void {
  document.documentElement.dataset.textSize = size
}

export function renderScene(root: HTMLElement, scene: Scene, _sceneId: string, nav: Nav): void {
  onContinue = null
  onPick = null
  renderedAt = Date.now()

  const kind = scene.kind ?? 'text'
  const hasChoices = kind === 'text' && !!scene.choices?.length
  const stage = h('div', { class: `stage stage--${kind}${hasChoices ? ' stage--choice' : ''}` })

  if (scene.image) stage.style.backgroundImage = `url("${scene.image}")`
  else stage.classList.add('stage--no-art')

  stage.append(hud(nav))

  if (kind === 'push') renderPush(stage, scene)
  else if (kind === 'end') renderEnd(stage, scene, nav)
  else if (hasChoices) renderChoice(stage, scene)
  else renderText(stage, scene)

  root.replaceChildren(stage)
  requestAnimationFrame(() => stage.classList.add('stage--visible'))
  preloadNextImages(scene)
}

// ---------------------------------------------------------------------------
// Верхняя панель и меню паузы
// ---------------------------------------------------------------------------

function hud(nav: Nav): HTMLElement {
  return h('div', { class: 'hud' }, [
    iconButton({ icon: 'menu', label: t('common.menu'), onClick: () => openPauseMenu(nav), tap: { target: 'reading.pause' }, variant: 'glass' }),
  ])
}

function openPauseMenu(nav: Nav): void {
  const info = currentInfo()
  if (!info) return
  const story = getStory(info.storyId)
  const p = getProgress(info.storyId)

  openSheet({
    title: story?.title ?? '',
    subtitle: t('reading.pauseSubtitle', {
      episode: story?.episodes.find((e) => e.n === info.episode)?.title ?? t('common.episodeN', { n: info.episode }),
      pct: p?.pct ?? 0,
    }),
    actions: [
      { label: t('reading.continueReading'), icon: 'play', variant: 'primary', onClick: () => closeTopOverlay(), tap: { target: 'pause.continue' } },
      { label: t('common.toStory'), icon: 'book', onClick: () => nav.toStory(info.storyId), tap: { target: 'pause.toStory' } },
      {
        label: t('common.restartEpisode'),
        icon: 'restart',
        variant: 'danger',
        tap: { target: 'pause.restart' },
        onClick: () =>
          confirmDialog({
            title: t('reading.restartTitle'),
            text: t('reading.restartText'),
            confirm: t('reading.restartConfirm'),
            danger: true,
            tap: 'dialog.restart',
            onConfirm: () => {
              closeTopOverlay() // шторка паузы
              restartEpisode()
            },
          }),
      },
    ],
    extra: textSizeControl(),
    tap: 'pause.close',
  })
}

/** Размер текста — сегменты из src/ui/kit: стрелки клавиатуры, в порядке Tab — только выбранный */
function textSizeControl(): HTMLElement {
  // Знак «А» трёх кеглей — как будет выглядеть текст
  const sizes: [TextSize, string, number][] = [
    ['s', t('reading.textSizeS'), 15],
    ['m', t('reading.textSizeM'), 19],
    ['l', t('reading.textSizeL'), 24],
  ]
  const group = segmented({
    label: t('reading.textSize'),
    options: sizes.map(([value, label, glyphSize]) => ({ value, label, glyph: t('reading.textSizeGlyph'), glyphSize })),
    value: getTextSize(),
    tap: 'pause.textSize',
    onChange: (value) => {
      const size = sizes.find(([s]) => s === value)?.[0]
      if (!size) return
      setTextSize(size)
      applyTextSize(size)
    },
  })
  return h('div', { class: 'sheet__extra' }, [h('div', { class: 'sheet__label', text: t('reading.textSize') }), group])
}

// ---------------------------------------------------------------------------
// Панель текста
// ---------------------------------------------------------------------------

function dialogPanel(scene: Scene): { dialog: HTMLElement; panel: HTMLElement } {
  const panel = h('div', { class: scene.speaker ? 'panel panel--speech' : 'panel panel--narration' }, [h('div', { class: 'text', text: scene.text })])
  const dialog = h('div', { class: 'dialog' }, [scene.speaker ? h('div', { class: 'speaker', text: scene.speaker }) : null, panel])
  return { dialog, panel }
}

/** Осталось ли что-то ниже видимой части панели */
function hasMore(panel: HTMLElement): boolean {
  return panel.scrollTop + panel.clientHeight < panel.scrollHeight - 4
}

/** Показывать «есть продолжение» (затемнение + стрелка) или обычный значок «дальше» */
function watchOverflow(panel: HTMLElement, dialog: HTMLElement): void {
  const update = (): void => {
    dialog.classList.toggle('dialog--more', hasMore(panel))
  }
  panel.addEventListener('scroll', update, { passive: true })
  requestAnimationFrame(update)
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(panel)
}

function renderText(stage: HTMLElement, scene: Scene): void {
  const { dialog, panel } = dialogPanel(scene)
  dialog.append(h('div', { class: 'dialog__more', 'aria-hidden': 'true' }, [icon('back', 'icon icon--down')]))
  if (scene.next) panel.append(h('div', { class: 'continue', 'aria-hidden': 'true', text: '▾' }))
  stage.append(dialog)
  watchOverflow(panel, dialog)

  if (!scene.next) return
  stage.classList.add('stage--tappable')
  const go = (): void => {
    if (!tapAllowed()) return
    // Длинный текст: сначала докрутить, потом листать
    if (hasMore(panel)) {
      panel.scrollBy({ top: Math.round(panel.clientHeight * 0.8), behavior: 'smooth' })
      return
    }
    hapticTap()
    advance()
  }
  stage.addEventListener('click', go)
  onContinue = go
}

// ---------------------------------------------------------------------------
// Выбор
// ---------------------------------------------------------------------------

function renderChoice(stage: HTMLElement, scene: Scene): void {
  const choices = scene.choices!
  const buttons: HTMLButtonElement[] = []
  let picked = false

  const pick = (index: number): void => {
    if (picked || !tapAllowed() || !buttons[index]) return
    picked = true
    hapticSelect()
    buttons.forEach((b, i) => {
      b.disabled = true
      b.classList.add(i === index ? 'choice--picked' : 'choice--dimmed')
    })
    setTimeout(() => makeChoice(index), PICK_DELAY_MS)
  }

  choices.forEach((choice, index) => {
    const b = choiceButton(choice, () => pick(index))
    b.style.setProperty('--i', String(index))
    buttons.push(b)
  })

  const { dialog, panel } = dialogPanel(scene)
  dialog.append(h('div', { class: 'dialog__more', 'aria-hidden': 'true' }, [icon('back', 'icon icon--down')]))
  stage.append(h('div', { class: 'choice-zone' }, [h('div', { class: 'choices', role: 'group', 'aria-label': t('reading.choiceGroup') }, buttons)]), dialog)
  watchOverflow(panel, dialog)
  // Длинный вопрос: тап по панели докручивает текст (листать некуда — ждём выбора)
  panel.addEventListener('click', () => {
    if (hasMore(panel)) panel.scrollBy({ top: Math.round(panel.clientHeight * 0.8), behavior: 'smooth' })
  })
  onPick = pick
}

function choiceButton(choice: Choice, onClick: () => void): HTMLButtonElement {
  const premium = typeof choice.price === 'number' && choice.price > 0
  const b = button(
    `choice${premium ? ' choice--premium' : ''}`,
    [
      h('span', { class: 'choice__text', text: choice.text }),
      premium ? h('span', { class: 'choice__price' }, [icon('star', 'icon icon--sm'), h('span', { text: String(choice.price) })]) : null,
    ],
    onClick,
    {},
    { target: 'reading.choice', value: choice.id, silent: true }, // пишет choice_made
  )
  b.dataset.type = choice.type ?? 'neutral'
  return b
}

// ---------------------------------------------------------------------------
// Пуш и конец эпизода
// ---------------------------------------------------------------------------

function renderPush(stage: HTMLElement, scene: Scene): void {
  const sender = scene.sender ?? t('reading.pushSender')
  stage.append(
    h('div', { class: 'push' }, [
      h('div', { class: 'push__head' }, [
        h('span', { class: 'push__icon', text: sender.charAt(0) }),
        h('span', { class: 'push__sender', text: sender }),
        h('span', { class: 'push__time', text: scene.time ?? t('reading.pushTime') }),
      ]),
      h('div', { class: 'push__text', text: scene.text }),
    ]),
  )

  if (!scene.next) return
  stage.append(h('div', { class: 'tap-hint', text: t('reading.tapHint') }))
  stage.classList.add('stage--tappable')
  const go = (): void => {
    if (!tapAllowed()) return
    hapticTap()
    advance()
  }
  stage.addEventListener('click', go)
  onContinue = go
}

function renderEnd(stage: HTMLElement, scene: Scene, nav: Nav): void {
  const info = currentInfo()
  if (!info) return
  const story = getStory(info.storyId)
  const nextMeta = story?.episodes.find((e) => e.n === info.episode + 1)
  const nextReady = !!nextMeta && nextMeta.status === 'available' && !!nextMeta.file

  hapticSuccess()

  stage.append(
    h('div', { class: 'end-card' }, [
      h('div', { class: 'end-card__seal', 'aria-hidden': 'true' }, [icon('check')]),
      h('div', { class: 'eyebrow', text: story ? t('reading.endEyebrow', { no: story.caseNo, story: story.title }) : '' }),
      h('div', { class: 'end-card__title', text: t('reading.endTitle', { n: info.episode }) }),
      scene.text ? h('div', { class: 'end-card__text', text: scene.text }) : null,
      nextMeta && !nextReady
        ? h('div', { class: 'end-card__next' }, [
            icon('lock', 'icon icon--sm'),
            h('span', { text: t('reading.endNextSoon', { episode: nextMeta.title }) }),
          ])
        : null,
      h('div', { class: 'end-card__actions' }, [
        nextReady
          ? button(
              'btn btn--primary btn--block btn--lg',
              [icon('play'), h('span', { text: t('reading.endReadNext', { episode: nextMeta!.title }) })],
              () => nav.read(info.storyId, nextMeta!.n),
              {},
              { target: 'end.readNext', value: nextMeta!.n },
            )
          : button('btn btn--primary btn--block btn--lg', [icon('book'), h('span', { text: t('common.toStory') })], () => nav.toStory(info.storyId), {}, {
              target: 'end.toStory',
            }),
        nextReady ? button('btn btn--secondary btn--block', t('common.toStory'), () => nav.toStory(info.storyId), {}, { target: 'end.toStory' }) : null,
        button(
          'btn btn--ghost btn--block',
          [icon('restart'), h('span', { text: t('common.restartEpisode') })],
          () => {
            if (!tapAllowed()) return
            hapticTap()
            restartEpisode()
          },
          {},
          { target: 'end.restart' },
        ),
      ]),
    ]),
  )
}

/** Заранее загрузить картинки следующих экранов */
function preloadNextImages(scene: Scene): void {
  const nextIds = [scene.next, ...(scene.choices ?? []).map((c) => c.next)]
  for (const id of nextIds) {
    const image = id ? peekScene(id)?.image : undefined
    if (image) new Image().src = image
  }
}
