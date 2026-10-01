/**
 * Моки API — пока на сервере нет эндпоинтов (шаги 8.x).
 * Данные правдоподобные и стабильные, с задержкой как у сети: интерфейс сразу учится
 * показывать загрузку. Когда эндпоинт появится, его строка в api.ts переключается на сеть,
 * а мок отсюда удаляется.
 */

import type { InboxResponse, WalletResponse } from './api'

const LATENCY_MS = 300

function later<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS))
}

const HOUR = 60 * 60 * 1000

export const mockApi = {
  getWallet(): Promise<WalletResponse> {
    return later({ balances: { nishtyak: 120, generic: 5 }, asOf: Date.now() })
  },

  getInbox(): Promise<InboxResponse> {
    const now = Date.now()
    return later({
      readUntil: now - 30 * HOUR,
      items: [
        {
          id: 'mock-episode-2',
          type: 'episode',
          title: '«Намертво»: эпизод 2 готовится',
          body: 'Пришлём сюда, как только он выйдет.',
          deeplink: 'story:namertvo',
          createdAt: now - 2 * HOUR,
        },
        {
          id: 'mock-reward-daily',
          type: 'reward',
          title: 'Ежедневная награда',
          body: '+10 ништяков за вход.',
          createdAt: now - 26 * HOUR,
        },
        {
          id: 'mock-system-welcome',
          type: 'system',
          title: 'Добро пожаловать в «Личные дела»',
          body: 'Здесь будут новости историй и награды.',
          createdAt: now - 72 * HOUR,
        },
      ],
    })
  },
}
