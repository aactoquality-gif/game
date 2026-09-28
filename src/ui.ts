/**
 * UI-рендеринг — чистый DOM, без фреймворков.
 *
 * Экран чтения по образцу «Клуба Романтики»: фон на весь экран,
 * снизу панель с плашкой имени говорящего и текстом, переход по тапу,
 * выборы — кнопками в той же панели. Плюс «пуш» поверх сцены и карточка конца эпизода.
 */

import type { Scene } from './types'
import { advance, makeChoice, peekScene, restartChapter } from './engine'
import { hapticSelect, hapticTap } from './telegram'

const app = document.getElementById('app')!

/** Защита от двойного тапа: сразу после смены экрана тапы игнорируются, мс */
const TAP_GUARD_MS = 350
let renderedAt = 0

/** Что делать по Enter / пробелу / стрелке вправо (для Telegram Desktop) */
let onContinue: (() => void) | null = null

document.addEventListener('keydown', (event) => {
  if (!onContinue) return
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowRight') {
    event.preventDefault()
    onContinue()
  }
})

function tapAllowed(): boolean {
  return Date.now() - renderedAt >= TAP_GUARD_MS
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Показать экран */
export function renderScene(scene: Scene, _sceneId: string): void {
  app.innerHTML = ''
  onContinue = null
  renderedAt = Date.now()

  const kind = scene.kind ?? 'text'
  const stage = el('div', `stage stage--${kind}`)

  if (scene.image) {
    stage.style.backgroundImage = `url("${scene.image}")`
  } else {
    stage.classList.add('stage--no-art')
  }

  if (kind === 'push') renderPush(stage, scene)
  else if (kind === 'end') renderEnd(stage, scene)
  else renderText(stage, scene)

  app.appendChild(stage)
  requestAnimationFrame(() => stage.classList.add('stage--visible'))

  preloadNextImages(scene)
}

/** Обычный экран: плашка имени + текст + (выборы или переход по тапу) */
function renderText(stage: HTMLElement, scene: Scene): void {
  const dialog = el('div', 'dialog')

  if (scene.speaker) dialog.appendChild(el('div', 'speaker', scene.speaker))

  const panel = el('div', scene.speaker ? 'panel panel--speech' : 'panel')
  panel.appendChild(el('div', 'text', scene.text))

  if (scene.choices?.length) {
    const list = el('div', 'choices')
    scene.choices.forEach((choice, index) => {
      const button = el('button', 'choice', choice.text)
      button.type = 'button'
      button.dataset.type = choice.type ?? 'neutral'
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        if (!tapAllowed()) return
        hapticSelect()
        makeChoice(index)
      })
      list.appendChild(button)
    })
    panel.appendChild(list)
  } else if (scene.next) {
    panel.appendChild(el('div', 'continue', '▾'))
    makeTappable(stage)
  }

  dialog.appendChild(panel)
  stage.appendChild(dialog)
}

/** «Пуш» — уведомление поверх сцены, как на экране телефона */
function renderPush(stage: HTMLElement, scene: Scene): void {
  const sender = scene.sender ?? 'Уведомление'

  const card = el('div', 'push')
  const head = el('div', 'push__head')
  head.appendChild(el('span', 'push__icon', sender.charAt(0)))
  head.appendChild(el('span', 'push__sender', sender))
  head.appendChild(el('span', 'push__time', scene.time ?? 'сейчас'))
  card.appendChild(head)
  card.appendChild(el('div', 'push__text', scene.text))
  stage.appendChild(card)

  if (scene.next) {
    stage.appendChild(el('div', 'tap-hint', 'Нажми, чтобы продолжить'))
    makeTappable(stage)
  }
}

/** Карточка конца эпизода */
function renderEnd(stage: HTMLElement, scene: Scene): void {
  const box = el('div', 'end')
  box.appendChild(el('div', 'end__title', scene.speaker ?? 'Конец эпизода'))
  box.appendChild(el('div', 'end__text', scene.text))

  const restart = el('button', 'choice choice--center', 'Начать эпизод сначала')
  restart.type = 'button'
  restart.addEventListener('click', () => {
    if (!tapAllowed()) return
    hapticTap()
    restartChapter()
  })
  box.appendChild(restart)
  stage.appendChild(box)
}

/** Переход дальше по тапу в любом месте экрана */
function makeTappable(stage: HTMLElement): void {
  stage.classList.add('stage--tappable')
  const go = (): void => {
    if (!tapAllowed()) return
    hapticTap()
    advance()
  }
  stage.addEventListener('click', go)
  onContinue = go
}

/** Заранее загрузить картинки следующих экранов, чтобы переход был без пустого фона */
function preloadNextImages(scene: Scene): void {
  const nextIds = [scene.next, ...(scene.choices ?? []).map((choice) => choice.next)]
  for (const id of nextIds) {
    const image = id ? peekScene(id)?.image : undefined
    if (image) new Image().src = image
  }
}

/** Показать экран загрузки */
export function renderLoading(): void {
  app.innerHTML = ''
  app.appendChild(el('div', 'loading', 'Загрузка…'))
}

/** Показать ошибку */
export function renderError(message: string): void {
  app.innerHTML = ''
  const box = el('div', 'error')
  box.appendChild(el('p', '', message))
  const retry = el('button', 'choice choice--center', 'Попробовать снова')
  retry.type = 'button'
  retry.addEventListener('click', () => location.reload())
  box.appendChild(retry)
  app.appendChild(box)
}
