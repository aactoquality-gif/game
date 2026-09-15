/**
 * Обёртка над Telegram WebApp API
 * https://core.telegram.org/bots/webapps
 */

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

interface TelegramWebApp {
  ready(): void
  expand(): void
  close(): void
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

/** Telegram WebApp instance (null если открыто вне Telegram) */
export const tg = window.Telegram?.WebApp ?? null

/** Инициализация TMA */
export function initTelegram(): void {
  if (!tg) {
    console.warn('Telegram WebApp API недоступен — запуск в режиме браузера')
    document.documentElement.classList.add('browser-mode')
    return
  }

  tg.ready()
  tg.expand()

  // Применяем тему Telegram
  applyTheme()
}

/** Применить цветовую тему Telegram к CSS-переменным */
function applyTheme(): void {
  if (!tg) return

  const root = document.documentElement
  const tp = tg.themeParams

  if (tp.bg_color) root.style.setProperty('--tg-bg', tp.bg_color)
  if (tp.text_color) root.style.setProperty('--tg-text', tp.text_color)
  if (tp.hint_color) root.style.setProperty('--tg-hint', tp.hint_color)
  if (tp.button_color) root.style.setProperty('--tg-button', tp.button_color)
  if (tp.button_text_color) root.style.setProperty('--tg-button-text', tp.button_text_color)
  if (tp.secondary_bg_color) root.style.setProperty('--tg-secondary-bg', tp.secondary_bg_color)
}

/** Тактильный отклик при нажатии */
export function hapticTap(): void {
  tg?.HapticFeedback.impactOccurred('light')
}

/** Тактильный отклик при выборе */
export function hapticSelect(): void {
  tg?.HapticFeedback.selectionChanged()
}

/** Получить имя пользователя */
export function getUserName(): string {
  return tg?.initDataUnsafe.user?.first_name ?? 'Путник'
}

/** Показать кнопку «Назад» */
export function showBackButton(callback: () => void): void {
  if (!tg) return
  tg.BackButton.show()
  tg.BackButton.onClick(callback)
}

/** Скрыть кнопку «Назад» */
export function hideBackButton(): void {
  tg?.BackButton.hide()
}
