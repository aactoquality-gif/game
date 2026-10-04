/**
 * Game — Telegram Mini App, визуальная новелла-антология
 * Точка входа
 */

import './style.css'
import { initTelegram, tg } from './telegram'
import { initEngine, onScene, getCatalog, isFirstLaunch, nextEpisodeFor, getTextSize } from './engine'
import { initAnalytics } from './analytics'
import { nav, app, renderLoading, renderError } from './app'
import { renderScene, applyTextSize } from './ui/reading'
import { startSync } from './sync'
import { initBackgroundMusic } from './audio'
import { t } from './i18n'

async function main(): Promise<void> {
  initTelegram()

  // Музыка — только слушатели жестов: трек грузится после первого касания, первый экран его не ждёт
  initBackgroundMusic()

  // Аналитика — до движка: движок шлёт первые события уже при открытии эпизода
  initAnalytics({
    platform: tg ? 'telegram' : 'browser',
    initData: tg?.initData ?? '',
  })

  renderLoading()
  onScene((scene, sceneId) => renderScene(app, scene, sceneId, nav))

  // Конфиг, баланс, входящие — в фоне: первый экран их не ждёт (бюджет ≤ 3 с, гипотеза H3)
  void startSync()

  try {
    await initEngine()
  } catch (error) {
    console.error(error)
    renderError(t('error.game'))
    return
  }

  applyTextSize(getTextSize())

  // Первый запуск — сразу в эпизод 1, без меню: первая минута (гипотеза H3) не должна уходить на навигацию
  const catalog = getCatalog()
  if (isFirstLaunch() && catalog.firstLaunch === 'story') {
    const first = nextEpisodeFor(catalog.defaultStory)
    if (first) {
      nav.read(catalog.defaultStory, first.meta.n)
      return
    }
  }
  nav.toMenu()
}

main()
