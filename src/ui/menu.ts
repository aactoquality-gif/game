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
import { t } from '../i18n'

export function renderMenu(root: HTMLElement, nav: Nav): void {
  const catalog = getCatalog()
  const screen = h('div', { class: 'screen screen--menu' }, [
    h('header', { class: 'menu-head' }, [
      h('div', { class: 'eyebrow', text: t('menu.eyebrow') }),
      h('h1', { class: 'menu-head__title', text: t('menu.title') }),
    ]),
    continueCard(nav),
    h('div', { class: 'section-head' }, [
      h('span', { class: 'section-head__title', text: t('menu.cases') }),
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
        h('div', { class: 'eyebrow', text: t('menu.continue') }),
        h('div', { class: 'continue-card__title', text: story.title }),
        h('div', { class: 'continue-card__meta', text: t('menu.continueMeta', { episode: next.meta.title, pct: p.pct }) }),
        progressBar(p.pct),
      ]),
      h('div', { class: 'continue-card__play' }, [icon('play')]),
    ],
    () => nav.read(storyId, next.meta.n),
    { 'aria-label': t('menu.continueAria', { story: story.title, episode: next.meta.title }) },
    { target: 'menu.continue', value: storyId },
  )
  return card
}

function folderCard(story: StoryMeta, nav: Nav): HTMLElement {
  const available = story.status === 'available'
  const p = getProgress(story.id)
  const released = story.episodes.filter((e) => e.status === 'available').length

  let meta: string
  if (!available) meta = t('common.soon')
  else if (p?.sceneId && !p.completed.includes(p.episode)) meta = t('menu.folderReading', { n: p.episode, pct: p.pct })
  else if (p?.completed.length) meta = t('menu.folderCompleted', { done: p.completed.length, total: story.episodes.length })
  else meta = t('menu.folderSeason', { released, total: story.episodes.length })

  return button(
    `folder${available ? '' : ' folder--soon'}`,
    [
      h('div', { class: 'folder__tab', text: t('common.caseNo', { no: story.caseNo }) }),
      h('div', { class: 'folder__body' }, [
        h('div', { class: 'folder__title', text: story.title }),
        h('div', { class: 'folder__hero', text: story.hero }),
        h('div', { class: 'folder__meta' }, [
          available ? null : icon('lock', 'icon icon--sm'),
          h('span', { text: meta }),
        ]),
        available && p?.sceneId && !p.completed.includes(p.episode) ? progressBar(p.pct) : null,
        available ? null : h('div', { class: 'stamp', text: t('menu.stampInDev') }),
      ]),
    ],
    () => (available ? nav.toStory(story.id) : toast(t('menu.storyInDevToast', { story: story.title }))),
    { style: `--tint:${story.tint}`, 'aria-label': `${story.title}, ${story.hero}. ${meta}` },
    { target: available ? 'menu.folder' : 'menu.folderSoon', value: story.id },
  )
}

export function progressBar(pct: number): HTMLElement {
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(pct), 'aria-valuemin': '0', 'aria-valuemax': '100' }, [
    h('div', { class: 'progress__fill', style: `width:${Math.max(0, Math.min(100, pct))}%` }),
  ])
}
