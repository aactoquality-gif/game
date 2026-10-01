/**
 * Навигация между экранами: меню → история → чтение.
 *
 * «Назад»: в Telegram — системная кнопка в шапке, в браузере — своя кнопка и Esc.
 * Сначала закрывает верхний слой (шторку, диалог), потом ведёт на экран выше.
 */

import type { Nav } from './ui/nav'
import { setNativeBack } from './telegram'
import { closeEpisode, openEpisode } from './engine'
import { track, updateContext } from './analytics'
import { renderMenu } from './ui/menu'
import { renderStory } from './ui/story'
import { onOverlayChange, hasOverlay, closeTopOverlay, closeAllOverlays } from './ui/overlay'
import { h, button } from './ui/dom'
import { store } from './store'

const app = document.getElementById('app')!

let backAction: (() => void) | null = null

function refreshNativeBack(): void {
  setNativeBack(hasOverlay() ? () => closeTopOverlay() : backAction)
}

function setBack(action: (() => void) | null): void {
  backAction = action
  refreshNativeBack()
}

export function goBack(): void {
  if (closeTopOverlay()) return
  backAction?.()
}

onOverlayChange(refreshNativeBack)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') goBack()
})

export const nav: Nav = {
  toMenu() {
    closeAllOverlays()
    closeEpisode()
    setBack(null)
    updateContext({ story: '', episode: 0, screen: '' })
    store.patch('ui', { route: { name: 'menu' } })
    renderMenu(app, nav)
    track('menu_view')
  },

  toStory(storyId) {
    closeAllOverlays()
    closeEpisode()
    setBack(() => nav.toMenu())
    updateContext({ story: storyId, episode: 0, screen: '' })
    store.patch('ui', { route: { name: 'story', storyId } })
    renderStory(app, storyId, nav)
    track('story_view')
  },

  read(storyId, episode, opts) {
    closeAllOverlays()
    setBack(() => nav.toStory(storyId))
    store.patch('ui', { route: { name: 'reading', storyId, episode } })
    renderLoading()
    openEpisode(storyId, episode, opts).catch((error) => {
      console.error('Не удалось открыть эпизод:', error)
      renderError('Не удалось загрузить эпизод. Проверь подключение к интернету.', () => nav.read(storyId, episode, opts))
    })
  },
}

export function renderLoading(): void {
  app.replaceChildren(h('div', { class: 'loading' }, [h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Загрузка…' })]))
}

export function renderError(message: string, retry: () => void = () => location.reload()): void {
  app.replaceChildren(
    h('div', { class: 'error' }, [h('p', { text: message }), button('btn btn--secondary', 'Попробовать снова', retry)]),
  )
}

export { app }
