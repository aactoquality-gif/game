/**
 * Тип выбора.
 * moral   — моральная развилка: главная и всегда бесплатная;
 * romance — романтическая развилка: в будущем платная (по модели КР);
 * neutral — бытовой выбор, калибровка тона.
 */
export type ChoiceType = 'moral' | 'romance' | 'neutral'

/** Вариант выбора игрока */
export interface Choice {
  /**
   * Постоянный ID выбора. Не меняется при правке текста:
   * по нему пишется аналитика и потом назначается цена (как id в метаданных выбора КР).
   */
  id: string
  /** Текст кнопки */
  text: string
  /** ID следующего экрана */
  next: string
  /** Тип выбора (по умолчанию neutral) */
  type?: ChoiceType
  /** Изменение скрытых счётчиков, например { "sovest": 1 } */
  effects?: Record<string, number>
  /**
   * Цена в звёздах. Есть цена — кнопка рисуется как премиум-выбор (золото + ценник, как у КР/7H).
   * Оплаты в Г1 нет: поле нужно, чтобы заранее видеть, как выглядит платная развилка.
   */
  price?: number
}

/**
 * Вид экрана.
 * text — обычный экран чтения (по умолчанию);
 * push — уведомление поверх сцены («Пуш Опеки»);
 * end  — карточка конца эпизода.
 */
export type SceneKind = 'text' | 'push' | 'end'

/** Игровой экран */
export interface Scene {
  kind?: SceneKind
  text: string
  /** Кто говорит. Нет поля — говорит рассказчик */
  speaker?: string
  /** Фоновая иллюстрация */
  image?: string
  /** Следующий экран по тапу — для экранов без выбора */
  next?: string
  choices?: Choice[]
  /** Для push: отправитель */
  sender?: string
  /** Для push: время в уведомлении */
  time?: string
}

/** Эпизод (глава) — набор экранов */
export interface Chapter {
  title: string
  startScene: string
  scenes: Record<string, Scene>
}

// ---------------------------------------------------------------------------
// Каталог историй (public/content/ru/catalog.json)
// ---------------------------------------------------------------------------

export type ReleaseStatus = 'available' | 'soon'

export interface EpisodeMeta {
  n: number
  title: string
  /** Файл эпизода в public/content/ru/. Нет файла — эпизод ещё не вышел */
  file?: string
  status: ReleaseStatus
}

export interface StoryMeta {
  id: string
  /** Номер дела на папке: «Дело № 01» */
  caseNo: string
  title: string
  /** Кто герой — одна строка под названием */
  hero: string
  description: string
  tags: string[]
  /** Цвет обложки-папки, пока нет арта */
  tint: string
  status: ReleaseStatus
  episodes: EpisodeMeta[]
}

export interface Catalog {
  /** Первый запуск: сразу в эпизод 1 (story) или в меню (menu) */
  firstLaunch: 'story' | 'menu'
  defaultStory: string
  stories: StoryMeta[]
}

// ---------------------------------------------------------------------------
// Сохранение v2 — по историям
// ---------------------------------------------------------------------------

export interface StoryProgress {
  /** Текущий эпизод */
  episode: number
  /** Текущий экран; пустая строка — эпизод ещё не начат */
  sceneId: string
  /** Скрытые счётчики — копятся через весь сезон */
  counters: Record<string, number>
  /** ID сделанных выборов по порядку (весь сезон) */
  picks: string[]
  /** Номер прохождения текущего эпизода (1 = первый раз, +1 при рестарте) */
  run: number
  /** Прочитанные эпизоды */
  completed: number[]
  /** Счётчики и выборы на момент старта эпизода — для «Начать эпизод сначала» */
  startCounters: Record<string, number>
  startPicks: string[]
  /** Сколько процентов эпизода прочитано — для карточки «Продолжить» */
  pct: number
  updatedAt: number
}

export type TextSize = 's' | 'm' | 'l'

export interface SaveData {
  v: 2
  /** Последняя открытая история */
  last: string | null
  stories: Record<string, StoryProgress>
  settings: { textSize: TextSize }
  savedAt: number
}
