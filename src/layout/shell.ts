/**
 * Каркас приложения (Шаг 1.1): хедер / контент / таббар.
 *
 * Только структура. Дальше в слоты подключаются компоненты:
 *   shell.header  — левая часть хедера (заголовок экрана, своя кнопка «Назад» в браузере)
 *   shell.account — пустой контейнер под блок «Аккаунт»
 *   shell.content — единственная прокручиваемая зона; сюда монтируются экраны
 *   shell.tabbar  — нижняя навигация
 *
 * Режим «immersive» убирает хедер и таббар — для экрана чтения.
 */

import { h } from '../ui/dom'

export type ChromeMode = 'full' | 'immersive'

export interface Shell {
  root: HTMLElement
  header: HTMLElement
  account: HTMLElement
  content: HTMLElement
  tabbar: HTMLElement
  setChrome(mode: ChromeMode): void
}

export function createShell(mount: HTMLElement, opts: { debug?: boolean } = {}): Shell {
  const header = h('div', { class: 'app-header__main', 'data-slot': 'header' })
  const account = h('div', { class: 'app-header__account', 'data-slot': 'account' })
  const content = h('main', { class: 'app-content', id: 'app-content', tabindex: '-1' })
  const tabbar = h('div', { class: 'app-tabbar__inner', 'data-slot': 'tabbar' })

  const root = h(
    'div',
    { class: 'app-shell', 'data-chrome': 'full', 'data-debug': opts.debug ? '' : undefined },
    [
      h('header', { class: 'app-header' }, [h('div', { class: 'app-header__inner' }, [header, account])]),
      content,
      h('nav', { class: 'app-tabbar', 'aria-label': 'Основная навигация' }, [tabbar]),
    ],
  )

  mount.replaceChildren(root)

  return {
    root,
    header,
    account,
    content,
    tabbar,
    setChrome(mode) {
      root.dataset.chrome = mode
    },
  }
}
