/**
 * Каркас приложения: кадр с тремя зонами — хедер / контент / таббар.
 *
 * Создаётся один раз в app.ts; экраны игры монтируются в shell.content. Слоты:
 *   shell.header  — левая часть хедера (заголовок экрана, своя «Назад» в браузере)
 *   shell.account — слот «Аккаунт»: пустой не занимает места; размещение — шаг 7
 *   shell.content — единственная прокручиваемая зона; сюда монтируются экраны
 *   shell.tabbar  — нижняя навигация (шаг 3.1)
 *   shell.backdrop — фон вокруг кадра на широком экране
 *
 * Режим 'immersive' убирает хедер и таббар — для экрана чтения.
 * Пустые зоны не показываются: хедер — пока пусты слоты header и account, таббар — пока пуст tabbar
 * (data-header / data-tabbar = on | off). Зоны появятся сами, когда шаги 3–4 положат в них кнопки.
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

  const syncZones = (): void => {
    root.dataset.header = header.hasChildNodes() || account.hasChildNodes() ? 'on' : 'off'
    root.dataset.tabbar = tabbar.hasChildNodes() ? 'on' : 'off'
  }
  const observer = new MutationObserver(syncZones)
  for (const slot of [header, account, tabbar]) observer.observe(slot, { childList: true })
  syncZones()

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
