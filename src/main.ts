/**
 * Game — Telegram Mini App текстовый квест
 * Точка входа
 */

import './style.css'
import { initTelegram, tg } from './telegram'
import { initEngine, onScene, getState } from './engine'
import { initAnalytics } from './analytics'
import { renderScene, renderLoading, renderError } from './ui'

async function main(): Promise<void> {
  // 1. Инициализируем Telegram WebApp
  initTelegram()

  // 2. Показываем загрузку
  renderLoading()

  // 3. Подписываемся на смену сцен
  onScene(renderScene)

  // 4. Запускаем движок (загрузит прогресс + первую главу)
  try {
    await initEngine()
  } catch {
    renderError('Не удалось загрузить игру. Проверь подключение к интернету.')
    return
  }

  // 5. Инициализируем аналитику после движка (чтобы знать episode и run)
  const state = getState()
  initAnalytics({
    platform: tg ? 'telegram' : 'browser',
    episode: state.chapter,
    run: state.run,
    initData: tg?.initData ?? '',
  })
}

main()
