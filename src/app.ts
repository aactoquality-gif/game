/**
 * Навигация между экранами: меню → история → чтение. Экраны живут в каркасе (src/layout/shell.ts):
 * в зоне контента, слои — внутри кадра; на чтении хедер и таббар убираются (режим immersive).
 *
 * «Назад»: в Telegram — системная кнопка в шапке; в браузере — своя кнопка, Esc и системная «Назад»
 * (жест Android, кнопка браузера). Сначала закрывает верхний слой (шторку, диалог), потом ведёт на экран выше.
 */

import type { Nav } from './ui/nav'
import { setNativeBack, tg } from './telegram'
import { closeEpisode, openEpisode } from './engine'
import { track, updateContext } from './analytics'
import { renderMenu } from './ui/menu'
import { renderStory } from './ui/story'
import { onOverlayChange, hasOverlay, closeTopOverlay, closeAllOverlays, setOverlayHost } from './ui/overlay'
import { h, button } from './ui/dom'
import { store } from './store'
import { t } from './i18n'
import { createShell } from './layout/shell'

const shell = createShell(document.getElementById('app')!)
/** Зона контента каркаса: сюда рендерятся все экраны */
const app = shell.content
setOverlayHost(shell.root)

// Чтение — без хедера и таббара, остальные экраны — с ними (пустые зоны каркас прячет сам)
store.select(
  (s) => s.ui.route.name,
  (name) => shell.setChrome(name === 'reading' ? 'immersive' : 'full'),
  { immediate: true },
)

let backAction: (() => void) | null = null

function refreshNativeBack(): void {
  setNativeBack(hasOverlay() ? () => closeTopOverlay('back') : backAction)
  syncHistoryGuard()
}

// ---------------------------------------------------------------------------
// Системная «Назад» в браузере. Без неё жест Android и кнопка браузера закрывают игру посреди эпизода.
// Пока игре есть куда возвращаться, в истории лежит одна «страховочная» запись: «Назад» снимает её,
// игра делает шаг назад и, если дальше ещё есть куда, кладёт запись снова. В Telegram — только BackButton.
// ---------------------------------------------------------------------------

const useHistory = !tg
let guarded = false

function syncHistoryGuard(): void {
  if (!useHistory) return
  const canGoBack = hasOverlay() || backAction !== null
  if (canGoBack && !guarded) {
    history.pushState({ gameBack: true }, '')
    guarded = true
  } else if (!canGoBack && guarded) {
    // Пришли к корню своей кнопкой — убираем лишнюю запись, чтобы следующая «Назад» сразу выходила
    guarded = false
    history.back()
  }
}

window.addEventListener('popstate', () => {
  if (!useHistory || !guarded) return
  guarded = false
  goBack()
  syncHistoryGuard()
})

function setBack(action: (() => void) | null): void {
  backAction = action
  refreshNativeBack()
}

/** «Назад» — сначала верхний слой (шторка, диалог), потом экран выше. reason — для аналитики закрытия слоя */
export function goBack(reason: 'back' | 'esc' = 'back'): void {
  if (closeTopOverlay(reason)) return
  backAction?.()
}

onOverlayChange(refreshNativeBack)

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') goBack('esc')
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
      renderError(t('error.episode'), () => nav.read(storyId, episode, opts))
    })
  },
}

export function renderLoading(): void {
  app.replaceChildren(h('div', { class: 'loading' }, [h('div', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: t('common.loading') })]))
}

export function renderError(message: string, retry: () => void = () => location.reload()): void {
  app.replaceChildren(
    h('div', { class: 'error' }, [h('p', { text: message }), button('btn btn--secondary', t('common.retry'), retry, {}, { target: 'error.retry' })]),
  )
}

export { app }
