/**
 * Состояние приложения — одно хранилище без фреймворка.
 *
 *   store.get()                         — текущее состояние (только чтение)
 *   store.patch('wallet', { ... })      — обновить часть одного раздела
 *   store.select(s => s.wallet, fn)     — подписка: fn(новое, старое) только когда раздел изменился
 *
 * Правила:
 * - компоненты не ходят в сеть: сеть → sync.ts → store → компоненты;
 * - разделы неизменяемые: patch создаёт новый объект раздела, поэтому сравнение по ссылке работает;
 * - деньги — только зеркало ответа сервера, без расчётов;
 * - прогресс историй и размер текста живут в engine.ts / storage.ts и сюда не дублируются.
 *
 * Новые разделы добавляются на своих шагах (настройки — 5.1, аккаунт — 7).
 */

import { DEFAULT_CONFIG, type InboxItem, type RemoteConfig } from './api'
import { getPlatform, type PlatformInfo } from './telegram'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type Route =
  | { readonly name: 'boot' }
  | { readonly name: 'menu' }
  | { readonly name: 'story'; readonly storyId: string }
  | { readonly name: 'reading'; readonly storyId: string; readonly episode: number }

export interface AppState {
  readonly platform: Readonly<PlatformInfo>
  /** Удалённый конфиг. status: ready — пришёл с сервера; idle / error — работают значения по умолчанию */
  readonly config: RemoteConfig & { readonly status: LoadStatus; readonly overrides: readonly string[] }
  /** Баланс — зеркало сервера. null — ещё не загружен (показывать «—», не 0) */
  readonly wallet: {
    readonly nishtyak: number | null
    readonly generic: number | null
    readonly status: LoadStatus
    readonly syncedAt: number
  }
  readonly inbox: {
    readonly items: readonly InboxItem[]
    readonly unread: number
    readonly status: LoadStatus
  }
  readonly ui: {
    readonly route: Route
  }
}

type Listener<T> = (value: T, prev: T) => void

export interface Store<S> {
  get(): S
  patch<K extends keyof S>(key: K, part: Partial<S[K]>): void
  select<T>(selector: (state: S) => T, listener: Listener<T>, opts?: { immediate?: boolean }): () => void
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial
  const watchers = new Set<() => void>()

  return {
    get: () => state,

    patch(key, part) {
      const current = state[key]
      const changed = Object.keys(part).some((k) => !Object.is((part as Record<string, unknown>)[k], (current as Record<string, unknown>)[k]))
      if (!changed) return
      state = { ...state, [key]: { ...current, ...part } }
      for (const watch of [...watchers]) watch()
    },

    select(selector, listener, opts = {}) {
      let prev = selector(state)
      const watch = (): void => {
        const next = selector(state)
        if (Object.is(next, prev)) return
        const old = prev
        prev = next
        listener(next, old)
      }
      watchers.add(watch)
      if (opts.immediate) listener(prev, prev)
      return () => {
        watchers.delete(watch)
      }
    },
  }
}

export const store = createStore<AppState>({
  platform: getPlatform(),
  config: { ...DEFAULT_CONFIG, status: 'idle', overrides: [] },
  wallet: { nishtyak: null, generic: null, status: 'idle', syncedAt: 0 },
  inbox: { items: [], unread: 0, status: 'idle' },
  ui: { route: { name: 'boot' } },
})

// Отладка: открыть игру с ?debug и в консоли вызвать __game.state()
declare global {
  interface Window {
    __game?: { state: () => AppState }
  }
}
if (new URLSearchParams(location.search).has('debug')) {
  window.__game = { state: () => store.get() }
}
