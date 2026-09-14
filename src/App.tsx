import { useState, useEffect } from 'react'
import Screen from './components/Screen'

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

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('intro')
  const [chapter, setChapter] = useState<Chapter | null>(null)

  useEffect(() => {
    fetch('/content/ru/ch1.json')
      .then(res => res.json())
      .then(data => setChapter(data))
      .catch(err => console.error('Ошибка:', err))
  }, [])

  if (!chapter) return <div style={{padding: '20px'}}>Загрузка...</div>

  const screen = chapter.screens[currentScreen]
  if (!screen) return <div>Ошибка</div>

  return (
    <div style={{maxWidth: '600px', margin: '0 auto', padding: '20px'}}>
      <Screen 
        screen={screen} 
        onChoice={(nextScreen) => setCurrentScreen(nextScreen)}
      />
    </div>
  )
}
