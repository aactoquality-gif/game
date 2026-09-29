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
  /** Вид экрана (по умолчанию text) */
  kind?: SceneKind
  /** Основной текст */
  text: string
  /** Кто говорит. Нет поля — говорит рассказчик */
  speaker?: string
  /** Фоновая иллюстрация */
  image?: string
  /** Следующий экран по тапу — для экранов без выбора */
  next?: string
  /** Варианты выбора */
  choices?: Choice[]
  /** Для push: отправитель */
  sender?: string
  /** Для push: время в уведомлении */
  time?: string
}

/** Глава — набор экранов */
export interface Chapter {
  /** Название главы */
  title: string
  /** ID первого экрана */
  startScene: string
  /** Карта экранов */
  scenes: Record<string, Scene>
}

/** Сохранённый прогресс игрока */
export interface GameState {
  /** Текущая глава */
  chapter: number
  /** Текущий экран */
  sceneId: string
  /** Флаги принятых решений */
  flags: Record<string, boolean>
  /** Скрытые счётчики — пишутся, но игроку не показываются */
  counters: Record<string, number>
  /** ID сделанных выборов по порядку */
  picks: string[]
  /** Номер прохождения эпизода (1 = первый раз, +1 при рестарте) */
  run: number
  /** Временная метка последнего сохранения */
  savedAt: number
}
