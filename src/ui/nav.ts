/** Переходы между экранами. Реализация — в app.ts; экраны получают её параметром, чтобы не было циклических импортов */
export interface Nav {
  toMenu(): void
  toStory(storyId: string): void
  read(storyId: string, episode: number, opts?: { restart?: boolean }): void
}
