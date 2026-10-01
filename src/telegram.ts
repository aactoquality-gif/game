/**
 * Обёртка над Telegram WebApp API
 * https://core.telegram.org/bots/webapps
 */

import { t } from './i18n'

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

interface TelegramWebApp {
  /** Подписанные данные запуска. Пустая строка — открыто не из Telegram */
  initData: string
  /** Версия Bot API, которую поддерживает клиент */
  version: string
  platform: string
  isVersionAtLeast(version: string): boolean
  ready(): void
  expand(): void
  close(): void
  setHeaderColor(color: string): void
  setBackgroundColor(color: string): void
  disableVerticalSwipes?(): void
  isExpanded: boolean
  viewportHeight: number
  viewportStableHeight: number
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  initDataUnsafe: {
    user?: {
      id: number
      first_name: string
      last_name?: string
      language_code?: string
    }
  }
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
  CloudStorage: {
    setItem(key: string, value: string, callback?: (error: string | null, success?: boolean) => void): void
    getItem(key: string, callback: (error: string | null, value?: string) => void): void
    getItems(keys: string[], callback: (error: string | null, values?: Record<string, string>) => void): void
    removeItem(key: string, callback?: (error: string | null, success?: boolean) => void): void
    getKeys(callback: (error: string | null, keys?: string[]) => void): void
  }
  BackButton: {
    isVisible: boolean
    show(): void
    hide(): void
    onClick(callback: () => void): void
    offClick(callback: () => void): void
  }
  MainButton: {
    text: string
    isVisible: boolean
    isActive: boolean
    show(): void
    hide(): void
    setText(text: string): void
    onClick(callback: () => void): void
    offClick(callback: () => void): void
  }
}

/** Цвет фона игры — совпадает с --game-bg в style.css */
const GAME_BG = '#14121a'

const webApp = window.Telegram?.WebApp

/**
 * Telegram WebApp instance, или null, если игра открыта не из Telegram.
 * Скрипт telegram-web-app.js создаёт объект и в обычном браузере (с версией 6.0),
 * поэтому признак «мы в Telegram» — непустой initData.
 */
export const tg = webApp && webApp.initData ? webApp : null

/** Платформа — для состояния приложения и решений интерфейса (например, блок «Аккаунт» — только в браузере) */
export interface PlatformInfo {
  kind: 'telegram' | 'browser'
  /** Клиент Telegram: ios, android, tdesktop, macos, weba…; вне Telegram — пусто */
  client: string
  /** Версия Bot API клиента; вне Telegram — пусто */
  version: string
  /** Десктоп: Telegram Desktop и веб-клиенты Telegram, вне Telegram — устройство с мышью */
  isDesktop: boolean
}

const DESKTOP_CLIENTS = ['tdesktop', 'macos', 'weba', 'webk', 'web', 'unigram']

export function getPlatform(): PlatformInfo {
  if (tg) return { kind: 'telegram', client: tg.platform, version: tg.version, isDesktop: DESKTOP_CLIENTS.includes(tg.platform) }
  const finePointer = typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches
  return { kind: 'browser', client: '', version: '', isDesktop: finePointer }
}

/** Поддерживает ли клиент Telegram нужную версию Bot API */
function supports(version: string): boolean {
  return !!tg && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast(version)
}

/** Облачное хранилище Telegram доступно с Bot API 6.9 */
export const cloudStorageSupported = supports('6.9')

/** Инициализация TMA */
export function initTelegram(): void {
  if (!tg) {
    console.info('Открыто не из Telegram — режим браузера, прогресс хранится только на устройстве')
    document.documentElement.classList.add('browser-mode')
    return
  }

  tg.ready()
  tg.expand()

  // Свайп вниз при чтении длинного экрана не должен закрывать игру
  if (supports('7.7')) tg.disableVerticalSwipes?.()

  // Шапка и фон Telegram — в цвет игры, чтобы не было светлой полосы сверху
  if (supports('6.9')) tg.setHeaderColor(GAME_BG)
  if (supports('6.1')) tg.setBackgroundColor(GAME_BG)
}

/** Тактильный отклик при переходе дальше */
export function hapticTap(): void {
  if (supports('6.1')) tg!.HapticFeedback.impactOccurred('light')
}

/** Тактильный отклик при выборе */
export function hapticSelect(): void {
  if (supports('6.1')) tg!.HapticFeedback.selectionChanged()
}

/** Получить имя пользователя */
export function getUserName(): string {
  return tg?.initDataUnsafe.user?.first_name ?? t('common.userFallback')
}

/** Системная кнопка «Назад» в шапке Telegram доступна */
export const nativeBackSupported = supports('6.1')

let backHandler: (() => void) | null = null

/**
 * Кнопка «Назад» в шапке Telegram: показать с обработчиком или скрыть (null).
 * Прошлый обработчик снимается — иначе клики копятся при каждой смене экрана.
 */
export function setNativeBack(handler: (() => void) | null): void {
  if (!nativeBackSupported) return
  if (backHandler) tg!.BackButton.offClick(backHandler)
  backHandler = handler
  if (handler) {
    tg!.BackButton.onClick(handler)
    tg!.BackButton.show()
  } else {
    tg!.BackButton.hide()
  }
}

/** Лёгкий отклик на успешное действие (конец эпизода) */
export function hapticSuccess(): void {
  if (supports('6.1')) tg!.HapticFeedback.notificationOccurred('success')
}
