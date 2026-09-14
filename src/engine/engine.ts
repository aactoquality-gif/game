export interface Screen {
  text: string
  image?: string
  choices: Array<{
    text: string
    nextScreen: string
  }>
}

export interface Chapter {
  screens: Record<string, Screen>
}

export async function loadChapter(lang: string = 'ru'): Promise<Chapter> {
  const response = await fetch(`/content/${lang}/ch1.json`)
  if (!response.ok) throw new Error('Ошибка загрузки главы')
  return response.json()
}

export function getScreen(chapter: Chapter, screenId: string): Screen | null {
  return chapter.screens[screenId] || null
}