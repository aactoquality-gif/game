import { useState, useEffect } from 'react'
import Screen from './Screen'

interface Chapter {
  screens: Record<string, {
    text: string
    image?: string
    choices: Array<{
      text: string
      nextScreen: string
    }>
  }>
}

export default function Game() {
  const [currentScreen, setCurrentScreen] = useState('intro')
  const [chapter, setChapter] = useState<Chapter | null>(null)

  useEffect(() => {
    // Загружаем первую главу
    fetch('/content/ru/ch1.json')
      .then(res => res.json())
      .then(data => setChapter(data))
      .catch(err => console.error('Ошибка загрузки:', err))
  }, [])

  if (!chapter) return <div>Загрузка...</div>

  const screen = chapter.screens[currentScreen]
  
  if (!screen) return <div>Экран не найден: {currentScreen}</div>

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <Screen 
        screen={screen} 
        onChoice={(nextScreen) => setCurrentScreen(nextScreen)}
      />
    </div>
  )
}