/** Вариант выбора игрока */
export interface Choice {
  /** Текст кнопки */
  text: string
  /** ID следующей сцены */
  next: string
  /** Условие показа (опционально) */
  condition?: string
}

/** Игровая сцена */
export interface Scene {
  /** Основной текст сцены */
  text: string
  /** URL изображения (опционально) */
  image?: string
  /** Варианты выбора */
  choices: Choice[]
}

/** Глава — набор сцен */
export interface Chapter {
  /** Название главы */
  title: string
  /** ID начальной сцены */
  startScene: string
  /** Карта сцен */
  scenes: Record<string, Scene>
}

/** Сохранённый прогресс игрока */
export interface GameState {
  /** Текущая глава */
  chapter: number
  /** Текущая сцена */
  sceneId: string
  /** Флаги принятых решений */
  flags: Record<string, boolean>
  /** Временная метка последнего сохранения */
  savedAt: number
}
