/**
 * Game — Telegram Mini App текстовый квест
 * Точка входа
 */

import './style.css'
import { initTelegram, tg } from './telegram'
import { initEngine, onScene } from './engine'
import { initAnalytics } from './analytics'
import { renderScene, renderLoading, renderError } from './ui'

async function main(): Promise<void> {
  // 1. Инициализируем Telegram WebApp
  initTelegram()

  // 2. Аналитика — до движка: движок шлёт первые события уже при загрузке главы
  initAnalytics({
    platform: tg ? 'telegram' : 'browser',
    initData: tg?.initData ?? '',
  })

  // 3. Показываем загрузку
  renderLoading()

  // 4. Подписываемся на смену сцен
  onScene(renderScene)

  // 5. Запускаем движок (загрузит прогресс + первую главу)
  try {
    await initEngine()
  } catch {
    renderError('Не удалось загрузить игру. Проверь подключение к интернету.')
  }
}

main()
