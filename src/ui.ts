/**
 * UI-рендеринг — чистый DOM, без фреймворков
 */

import type { Scene } from './types'
import { makeChoice } from './engine'
import { hapticTap } from './telegram'

const app = document.getElementById('app')!

/** Показать сцену */
export function renderScene(scene: Scene, _sceneId: string): void {
  app.innerHTML = ''

  // Контейнер сцены
  const container = document.createElement('div')
  container.className = 'scene'

  // Изображение (если есть)
  if (scene.image) {
    const img = document.createElement('img')
    img.src = scene.image
    img.className = 'scene-image'
    img.alt = ''
    img.loading = 'lazy'
    container.appendChild(img)
  }

  // Текст сцены (поддержка переносов строк)
  const textBlock = document.createElement('div')
  textBlock.className = 'scene-text'
  textBlock.innerHTML = scene.text.replace(/\n/g, '<br>')
  container.appendChild(textBlock)

  // Кнопки выбора
  if (scene.choices.length > 0) {
    const choicesBlock = document.createElement('div')
    choicesBlock.className = 'choices'

    scene.choices.forEach((choice, index) => {
      const btn = document.createElement('button')
      btn.className = 'choice-btn'
      btn.textContent = choice.text
      btn.addEventListener('click', () => {
        hapticTap()
        makeChoice(index)
      })
      choicesBlock.appendChild(btn)
    })

    container.appendChild(choicesBlock)
  }

  app.appendChild(container)

  // Плавное появление
  requestAnimationFrame(() => {
    container.classList.add('scene--visible')
  })
}

/** Показать экран загрузки */
export function renderLoading(): void {
  app.innerHTML = '<div class="loading">Загрузка...</div>'
}

/** Показать ошибку */
export function renderError(message: string): void {
  app.innerHTML = `
    <div class="error">
      <p>${message}</p>
      <button class="choice-btn" onclick="location.reload()">Попробовать снова</button>
    </div>
  `
}
