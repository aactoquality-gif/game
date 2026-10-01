/**
 * Каркас приложения: кадр с тремя зонами — хедер / контент / таббар.
 *
 * Шаг 1.1 — только структура, в игру подключается на шаге 1.2. Слоты:
 *   shell.header  — левая часть хедера (заголовок экрана, своя «Назад» в браузере)
 *   shell.account — слот «Аккаунт»: пустой не занимает места; размещение — шаг 7
 *   shell.content — единственная прокручиваемая зона; сюда монтируются экраны
 *   shell.tabbar  — нижняя навигация (шаг 3.1)
 *   shell.backdrop — фон вокруг кадра на широком экране
 *
 * Режим 'immersive' убирает хедер и таббар — для экрана чтения.
 * Стили — shell.css: размер кадра решает окно, всё внутри — @container app.
 */

import './shell.css'
import { h } from '../ui/dom'
import { t } from '../i18n'

export type ChromeMode = 'full' | 'immersive'

export interface Shell {
  root: HTMLElement
  backdrop: HTMLElement
  header: HTMLElement
  account: HTMLElement
  content: HTMLElement
  tabbar: HTMLElement
  setChrome(mode: ChromeMode): void
}

export function createShell(mount: HTMLElement): Shell {
  const header = h('div', { class: 'app-header__main', 'data-slot': 'header' })
  const account = h('div', { class: 'app-header__account', 'data-slot': 'account' })
  const content = h('main', { class: 'app-content', id: 'app-content', tabindex: '-1' })
  const tabbar = h('div', { class: 'app-tabbar__inner', 'data-slot': 'tabbar' })
  const backdrop = h('div', { class: 'app-backdrop', 'aria-hidden': 'true' })

  const root = h('div', { class: 'app-shell', 'data-chrome': 'full' }, [
    h('header', { class: 'app-header' }, [h('div', { class: 'app-header__inner' }, [header, account])]),
    content,
    h('nav', { class: 'app-tabbar', 'aria-label': t('shell.tabbar') }, [tabbar]),
  ])

  mount.replaceChildren(backdrop, root)

  return {
    root,
    backdrop,
    header,
    account,
    content,
    tabbar,
    setChrome(mode) {
      root.dataset.chrome = mode
    },
  }
}
