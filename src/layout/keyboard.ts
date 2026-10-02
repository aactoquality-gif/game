/**
 * Экранная клавиатура: кадр всегда занимает видимую часть экрана над ней, поле в фокусе — на виду.
 *
 * Как ведут себя платформы:
 *   Android (Chrome, WebView, Telegram Android) — index.html просит interactive-widget=resizes-content:
 *     клавиатура уменьшает сам экран (layout viewport), кадр position: fixed ужимается сам.
 *   iOS (Safari, WKWebView, Telegram iOS) — клавиатура ПЕРЕКРЫВАЕТ экран: уменьшается только видимая
 *     область (visualViewport), а iOS ещё и сдвигает страницу вверх (offsetTop).
 * Поэтому кадр ставится ровно в видимую область: --kb-top (сдвиг сверху) и --kb-inset (сколько снизу
 * закрыто клавиатурой) — shell.css превращает их в top / bottom кадра. Шторки, диалоги и тосты живут
 * внутри кадра и поднимаются вместе с ним.
 *
 * Пока поле ввода в фокусе и клавиатура открыта — data-keyboard="open" на кадре: таббар прячется,
 * отступ под home bar не нужен (его закрывает клавиатура). Поле (вместе с подписью и подсказкой —
 * блок .ui-field, его scroll-margin) докручивается в своей прокручиваемой зоне: экран или тело шторки.
 * Докручивается и тогда, когда блок поля вырос (появилась ошибка под ним) — ResizeObserver.
 */

/** Меньше — это панель браузера или подсказки, а не клавиатура */
const OPEN_MIN_PX = 80

/** Поле, для которого появляется экранная клавиатура */
export function isTextEntry(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image', 'hidden'].includes(el.type)
  }
  return el instanceof HTMLElement && el.isContentEditable
}

/** Ближайшая прокручиваемая зона внутри кадра */
function scrollParent(el: HTMLElement, frame: HTMLElement): HTMLElement | null {
  for (let n = el.parentElement; n && n !== frame; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n
  }
  return null
}

/**
 * Докрутить поле в видимую часть его зоны: снизу — над краем кадра (он уже над клавиатурой),
 * сверху — не выше начала зоны. Отступы — scroll-margin блока поля.
 */
export function revealField(field: HTMLElement, frame: HTMLElement): void {
  const target = field.closest<HTMLElement>('.ui-field') ?? field
  const scroller = scrollParent(target, frame)
  if (!scroller) return
  const zone = scroller.getBoundingClientRect()
  const bottom = Math.min(zone.bottom, frame.getBoundingClientRect().bottom)
  const box = target.getBoundingClientRect()
  const cs = getComputedStyle(target)
  const marginTop = parseFloat(cs.scrollMarginTop) || 0
  const marginBottom = parseFloat(cs.scrollMarginBottom) || 0
  let delta = 0
  if (box.bottom + marginBottom > bottom) delta = box.bottom + marginBottom - bottom
  // Поле выше зоны (или выше, чем помещается) — важнее верх: подпись и само поле
  if (box.top - marginTop - delta < zone.top) delta = box.top - marginTop - zone.top
  if (Math.abs(delta) >= 1) scroller.scrollTop += delta
}

/** Следить за клавиатурой для кадра. Возвращает отписку (для стендов и тестов) */
export function watchKeyboard(frame: HTMLElement): () => void {
  const vv = window.visualViewport
  /** Высота экрана без клавиатуры при этой ширине — по ней видно, что Android ужал экран */
  let fullHeight = 0
  let fullWidth = 0
  let raf = 0
  let wasOpen = false
  /** Блок поля в фокусе: вырос (ошибка, многострочный текст) — докрутить снова */
  const grow = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null

  const update = (): void => {
    raf = 0
    const layoutH = document.documentElement.clientHeight
    const layoutW = document.documentElement.clientWidth
    if (layoutW !== fullWidth) {
      fullWidth = layoutW
      fullHeight = layoutH
    }
    fullHeight = Math.max(fullHeight, layoutH)

    const top = vv ? Math.max(0, Math.round(vv.offsetTop)) : 0
    const inset = vv ? Math.max(0, Math.round(layoutH - vv.height - vv.offsetTop)) : 0
    // Сколько экрана закрыто — без учёта сдвига iOS: сдвиг уменьшает inset, но клавиатура та же
    const covered = vv ? Math.round(layoutH - vv.height) : 0
    const active = document.activeElement
    const typing = isTextEntry(active) && frame.contains(active)
    const open = typing && (covered > OPEN_MIN_PX || fullHeight - layoutH > OPEN_MIN_PX)

    // Сдвиг ставится только при открытой клавиатуре: панели браузера не должны дёргать кадр
    frame.style.setProperty('--kb-top', `${open ? top : 0}px`)
    frame.style.setProperty('--kb-inset', `${open ? inset : 0}px`)
    if (open) frame.dataset.keyboard = 'open'
    else delete frame.dataset.keyboard

    if (typing) revealField(active, frame)
    // iOS иногда оставляет страницу прокрученной после закрытия клавиатуры — возвращаем на место
    if (wasOpen && !open && (window.scrollY || document.scrollingElement?.scrollTop)) window.scrollTo(0, 0)
    wasOpen = open
  }
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(update)
  }
  // Клавиатура выезжает ~250 мс: пересчёт по событиям размера и ещё раз, когда анимация закончится
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  const onFocus = (): void => {
    schedule()
    clearTimeout(settleTimer)
    settleTimer = setTimeout(schedule, 350)
    grow?.disconnect()
    const active = document.activeElement
    if (isTextEntry(active) && frame.contains(active)) grow?.observe(active.closest('.ui-field') ?? active)
  }

  vv?.addEventListener('resize', schedule)
  vv?.addEventListener('scroll', schedule)
  window.addEventListener('resize', schedule)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  schedule()

  return () => {
    cancelAnimationFrame(raf)
    clearTimeout(settleTimer)
    grow?.disconnect()
    vv?.removeEventListener('resize', schedule)
    vv?.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    document.removeEventListener('focusin', onFocus)
    document.removeEventListener('focusout', onFocus)
  }
}
