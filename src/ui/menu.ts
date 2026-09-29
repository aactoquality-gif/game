/**
 * Главное меню «Личные дела» — аналог StoriesPage (КР) / MainStoriesView (7H):
 * карточка «Продолжить» (InProgressButton / ContinueButton) и каталог историй.
 * Истории оформлены как папки личных дел — отсылка к прологу с веером дел.
 */

import type { Nav } from './nav'
import type { StoryMeta } from '../types'
import { getCatalog, getLastStoryId, getProgress, getStory, nextEpisodeFor } from '../engine'
import { h, button, icon } from './dom'
import { toast } from './overlay'

export function renderMenu(root: HTMLElement, nav: Nav): void {
  const catalog = getCatalog()
  const screen = h('div', { class: 'screen screen--menu' }, [
    h('header', { class: 'menu-head' }, [
      h('div', { class: 'eyebrow', text: 'Антология' }),
      h('h1', { class: 'menu-head__title', text: 'Личные дела' }),
    ]),
    continueCard(nav),
    h('div', { class: 'section-head' }, [
      h('span', { class: 'section-head__title', text: 'Дела' }),
      h('span', { class: 'section-head__count', text: String(catalog.stories.length) }),
    ]),
    h('div', { class: 'folders' }, catalog.stories.map((s) => folderCard(s, nav))),
  ])
  root.replaceChildren(screen)
}

/** «Продолжить» — только если есть недочитанный эпизод */
function continueCard(nav: Nav): HTMLElement | null {
  const storyId = getLastStoryId()
  if (!storyId) return null
  const next = nextEpisodeFor(storyId)
  const story = getStory(storyId)
  const p = getProgress(storyId)
  if (!story || !next || next.state !== 'continue' || !p) return null

  const card = button(
    'continue-card',
    [
      h('div', { class: 'continue-card__thumb', style: `--tint:${story.tint}` }, [h('span', { text: story.caseNo })]),
      h('div', { class: 'continue-card__body' }, [
        h('div', { class: 'eyebrow', text: 'Продолжить' }),
        h('div', { class: 'continue-card__title', text: story.title }),
        h('div', { class: 'continue-card__meta', text: `${next.meta.title} · ${p.pct}%` }),
        progressBar(p.pct),
      ]),
      h('div', { class: 'continue-card__play' }, [icon('play')]),
    ],
    () => nav.read(storyId, next.meta.n),
    { 'aria-label': `Продолжить: ${story.title}, ${next.meta.title}` },
  )
  return card
}

function folderCard(story: StoryMeta, nav: Nav): HTMLElement {
  const available = story.status === 'available'
  const p = getProgress(story.id)
  const released = story.episodes.filter((e) => e.status === 'available').length

  let meta: string
  if (!available) meta = 'Скоро'
  else if (p?.sceneId && !p.completed.includes(p.episode)) meta = `Читаешь · эпизод ${p.episode} · ${p.pct}%`
  else if (p?.completed.length) meta = `Прочитано эпизодов: ${p.completed.length} из ${story.episodes.length}`
  else meta = `Сезон 1 · ${released} из ${story.episodes.length} эп.`

  return button(
    `folder${available ? '' : ' folder--soon'}`,
    [
      h('div', { class: 'folder__tab', text: `Дело № ${story.caseNo}` }),
      h('div', { class: 'folder__body' }, [
        h('div', { class: 'folder__title', text: story.title }),
        h('div', { class: 'folder__hero', text: story.hero }),
        h('div', { class: 'folder__meta' }, [
          available ? null : icon('lock', 'icon icon--sm'),
          h('span', { text: meta }),
        ]),
        available && p?.sceneId && !p.completed.includes(p.episode) ? progressBar(p.pct) : null,
        available ? null : h('div', { class: 'stamp', text: 'В разработке' }),
      ]),
    ],
    () => (available ? nav.toStory(story.id) : toast(`«${story.title}» — в разработке`)),
    { style: `--tint:${story.tint}`, 'aria-label': `${story.title}, ${story.hero}. ${meta}` },
  )
}

export function progressBar(pct: number): HTMLElement {
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
    h('div', { class: 'progress__fill', style: `width:${Math.max(0, Math.min(100, pct))}%` }),
  ])
}
