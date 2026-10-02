/**
 * Строки интерфейса — русский. Это эталон: ключи отсюда — полный список, другие языки
 * обязаны перевести каждый (тип Messages в i18n.ts).
 *
 * Не сюда: тексты историй, названия эпизодов и описания — это контент (public/content/<язык>/).
 * Подстановки — {имя}. Формы по числу — объект { one, few, many, other } и параметр count.
 */

export const ru = {
  // Общее
  'common.loading': 'Загрузка…',
  'common.retry': 'Попробовать снова',
  'common.cancel': 'Отмена',
  'common.back': 'Назад',
  'common.menu': 'Меню',
  'common.soon': 'Скоро',
  'common.toStory': 'К истории',
  'common.restartEpisode': 'Начать эпизод сначала',
  'common.caseNo': 'Дело № {no}',
  'common.episodeN': 'Эпизод {n}',
  'common.userFallback': 'Путник',

  // Каркас
  'shell.tabbar': 'Основная навигация',

  // Базовые компоненты (src/ui/kit): бейдж и подписи для скринридера у кнопок с бейджем
  'kit.badgeOverflow': '{max}+',
  'kit.badgeDot': 'Есть новое',
  'kit.a11yCount': { one: '{label}: {count} новое', few: '{label}: {count} новых', many: '{label}: {count} новых', other: '{label}: {count} нового' },
  'kit.a11yDot': '{label}: есть новое',
  'kit.a11yLabel': '{label}: {badge}',

  // Ошибки загрузки
  'error.game': 'Не удалось загрузить игру. Проверь подключение к интернету.',
  'error.episode': 'Не удалось загрузить эпизод. Проверь подключение к интернету.',

  // Главное меню «Личные дела»
  'menu.eyebrow': 'Антология',
  'menu.title': 'Личные дела',
  'menu.cases': 'Дела',
  'menu.continue': 'Продолжить',
  'menu.continueMeta': '{episode} · {pct}%',
  'menu.continueAria': 'Продолжить: {story}, {episode}',
  'menu.folderReading': 'Читаешь · эпизод {n} · {pct}%',
  'menu.folderCompleted': 'Прочитано эпизодов: {done} из {total}',
  'menu.folderSeason': 'Сезон 1 · {released} из {total} эп.',
  'menu.stampInDev': 'В разработке',
  'menu.storyInDevToast': '«{story}» — в разработке',

  // Экран истории
  'story.continue': 'Продолжить · {episode}',
  'story.read': 'Читать',
  'story.readEpisode': 'Читать · {episode}',
  'story.nextSoon': '{episode} — скоро',
  'story.seasonDone': 'Сезон прочитан',
  'story.season': 'Сезон 1',
  'story.episodesCount': '{count} эп.',
  'story.episodeLater': '{episode} выйдет позже',
  'story.statusReading': 'Читаешь · {pct}%',
  'story.statusRead': 'Прочитан',
  'story.statusAvailable': 'Доступен',
  'story.rereadTitle': 'Перечитать {episode}?',
  'story.rereadText': 'Выборы этого эпизода сбросятся, прогресс сезона до него сохранится.',
  'story.rereadConfirm': 'Перечитать',

  // Чтение
  'reading.pauseSubtitle': '{episode} · {pct}%',
  'reading.continueReading': 'Продолжить чтение',
  'reading.restartTitle': 'Начать эпизод сначала?',
  'reading.restartText': 'Выборы этого эпизода сбросятся. Прочитанное в прошлых эпизодах сохранится.',
  'reading.restartConfirm': 'Начать сначала',
  'reading.textSize': 'Размер текста',
  'reading.textSizeGlyph': 'А',
  'reading.textSizeS': 'Мельче',
  'reading.textSizeM': 'Обычный',
  'reading.textSizeL': 'Крупнее',
  'reading.choiceGroup': 'Выбор',
  'reading.pushSender': 'Уведомление',
  'reading.pushTime': 'сейчас',
  'reading.tapHint': 'Нажми, чтобы продолжить',
  'reading.endEyebrow': 'Дело № {no} · {story}',
  'reading.endTitle': 'Эпизод {n} пройден',
  'reading.endNextSoon': '{episode} — скоро',
  'reading.endReadNext': 'Читать · {episode}',
} as const
