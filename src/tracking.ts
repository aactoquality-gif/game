/**
 * Каталог событий аналитики — единственный список того, что игра может отправить.
 *
 * Имена событий — только a-z и «_», до 40 символов: остальное сервер отбрасывает МОЛЧА
 * (server/index.mjs, cleanEvent). Поэтому track() принимает только имена отсюда.
 *
 * Два вида событий:
 * 1. Продуктовые — шаги воронок и метрики гипотез (screen_view, choice_made, позже paywall_view).
 *    Отдельное имя на каждый шаг, имена существующих не менять: по ним считается отчёт Г1.
 * 2. Нажатия на элементы интерфейса — одно событие ui_tap с целью из UI_TARGETS:
 *    { target: 'menu.folder', value: 'namertvo' }. Новая кнопка = новая цель здесь,
 *    а не новое имя события. Отчёт Г1 нажатия не учитывает.
 *
 * Кнопка подключается к аналитике параметром tap у button() (src/ui/dom.ts).
 * check:ui краснеет на любой видимой кнопке без цели (атрибут data-track).
 */

import { track } from './analytics'

export const EVENT_NAMES = [
  // Г1: открытие игры и эпизода, прохождение, выборы, уход
  'episode_enter',
  'episode_start',
  'screen_view',
  'choice_made',
  'episode_complete',
  'episode_exit',
  'app_hide',
  // Навигация между экранами
  'menu_view',
  'story_view',
  // Нажатия на элементы интерфейса
  'ui_tap',
] as const

export type EventName = (typeof EVENT_NAMES)[number]

export const UI_TARGETS = [
  // Главное меню
  'menu.continue', // карточка «Продолжить»; value — история
  'menu.folder', // папка доступной истории; value — история
  'menu.folderSoon', // папка истории «в разработке» — сигнал спроса на следующую историю; value — история
  // Экран истории
  'story.back',
  'story.cta', // главная кнопка; value — continue / read
  'story.episode', // открыть доступный или текущий эпизод; value — номер
  'story.episodeSoon', // эпизод «скоро» — сигнал спроса; value — номер
  'story.episodeReread', // прочитанный эпизод → диалог «Перечитать?»; value — номер
  // Чтение
  'reading.pause', // кнопка меню паузы
  'reading.choice', // выбор: пишет choice_made, ui_tap не дублируется
  // Меню паузы
  'pause.continue',
  'pause.toStory',
  'pause.restart', // открыть диалог «Начать сначала?»
  'pause.textSize', // value — s / m / l
  // Карточка конца эпизода
  'end.readNext', // value — номер следующего эпизода
  'end.toStory',
  'end.restart',
  // Диалоги подтверждения: value — confirm / cancel
  'dialog.restart',
  'dialog.reread',
  // Экран ошибки загрузки
  'error.retry',
] as const

export type UiTarget = (typeof UI_TARGETS)[number]

/** Привязка кнопки к аналитике */
export interface Tap {
  readonly target: UiTarget
  readonly value?: string | number
  /** Нажатие уже пишет продуктовое событие (choice_made) — ui_tap не отправлять */
  readonly silent?: boolean
}

export function trackTap(tap: Tap): void {
  if (tap.silent) return
  track('ui_tap', tap.value === undefined ? { target: tap.target } : { target: tap.target, value: tap.value })
}
