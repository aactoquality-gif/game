/**
 * Game — Telegram Mini App текстовый квест
 * Точка входа
 */

import './style.css'
import { initTelegram } from './telegram'
import { initEngine, onScene } from './engine'
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
  }
}

main()
