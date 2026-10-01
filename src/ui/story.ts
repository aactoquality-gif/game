/**
 * Экран истории — аналог StoryView (7H) / страницы серии КР:
 * обложка-папка, герой, описание, главная кнопка (ReadButton / ContinueButton)
 * и список эпизодов сезона со статусами (EpisodeCountButton, ProgressBar).
 */

import type { Nav } from './nav'
import type { EpisodeMeta, StoryProgress } from '../types'
import { getProgress, getStory, nextEpisodeFor } from '../engine'
import { h, button, icon } from './dom'
import { confirmDialog, toast } from './overlay'
import { progressBar } from './menu'
import type { Tap } from '../tracking'
import { t } from '../i18n'

export function renderStory(root: HTMLElement, storyId: string, nav: Nav): void {
  const story = getStory(storyId)
  if (!story) return nav.toMenu()
  const p = getProgress(storyId)
  const next = nextEpisodeFor(storyId)

  // Главная кнопка
  let cta: HTMLElement
  if (next?.state === 'continue') {
    cta = button(
      'btn btn--primary btn--block btn--lg',
      [icon('play'), h('span', { text: t('story.continue', { episode: next.meta.title }) })],
      () => nav.read(storyId, next.meta.n),
      {},
      { target: 'story.cta', value: 'continue' },
    )
  } else if (next) {
    const label = next.meta.n === 1 && !p?.completed.length ? t('story.read') : t('story.readEpisode', { episode: next.meta.title })
    cta = button('btn btn--primary btn--block btn--lg', [icon('book'), h('span', { text: label })], () => nav.read(storyId, next.meta.n), {}, {
      target: 'story.cta',
      value: 'read',
    })
  } else {
    const soon = story.episodes.find((e) => e.status === 'soon')
    cta = h('button', { class: 'btn btn--secondary btn--block btn--lg', type: 'button', disabled: '' }, [
      icon('lock'),
      h('span', { text: soon ? t('story.nextSoon', { episode: soon.title }) : t('story.seasonDone') }),
    ])
  }

  const screen = h('div', { class: 'screen screen--story' }, [
    h('div', { class: 'topbar' }, [button('icon-btn btn-back', [icon('back')], () => nav.toMenu(), { 'aria-label': t('common.back') }, { target: 'story.back' })]),
    h('div', { class: 'story-cover', style: `--tint:${story.tint}` }, [
      h('div', { class: 'story-cover__case', text: t('common.caseNo', { no: story.caseNo }) }),
      h('h1', { class: 'story-cover__title', text: story.title }),
      h('div', { class: 'story-cover__hero', text: story.hero }),
    ]),
    h('div', { class: 'story-body' }, [
      story.description ? h('p', { class: 'story-body__desc', text: story.description }) : null,
      story.tags.length ? h('div', { class: 'tags' }, story.tags.map((t) => h('span', { class: 'tag', text: t }))) : null,
      cta,
      h('div', { class: 'section-head' }, [
        h('span', { class: 'section-head__title', text: t('story.season') }),
        h('span', { class: 'section-head__count', text: t('story.episodesCount', { count: story.episodes.length }) }),
      ]),
      h('div', { class: 'episodes' }, story.episodes.map((e) => episodeRow(storyId, e, p, nav))),
    ]),
  ])
  root.replaceChildren(screen)
}

function episodeRow(storyId: string, e: EpisodeMeta, p: StoryProgress | null, nav: Nav): HTMLElement {
  const released = e.status === 'available' && !!e.file
  const done = !!p?.completed.includes(e.n)
  const reading = !!p && p.episode === e.n && !!p.sceneId && !done

  let status: HTMLElement
  let onClick: () => void
  let tap: Tap = { target: 'story.episode', value: e.n }
  let cls = 'episode'

  if (!released) {
    cls += ' episode--soon'
    status = h('span', { class: 'episode__status' }, [icon('lock', 'icon icon--sm'), h('span', { text: t('common.soon') })])
    onClick = () => toast(t('story.episodeLater', { episode: e.title }))
    tap = { target: 'story.episodeSoon', value: e.n }
  } else if (reading) {
    cls += ' episode--current'
    status = h('span', { class: 'episode__status episode__status--accent', text: t('story.statusReading', { pct: p!.pct }) })
    onClick = () => nav.read(storyId, e.n)
  } else if (done) {
    cls += ' episode--done'
    status = h('span', { class: 'episode__status episode__status--ok' }, [icon('check', 'icon icon--sm'), h('span', { text: t('story.statusRead') })])
    onClick = () =>
      confirmDialog({
        title: t('story.rereadTitle', { episode: e.title.toLowerCase() }),
        text: t('story.rereadText'),
        confirm: t('story.rereadConfirm'),
        tap: 'dialog.reread',
        onConfirm: () => nav.read(storyId, e.n, { restart: true }),
      })
    tap = { target: 'story.episodeReread', value: e.n }
  } else {
    status = h('span', { class: 'episode__status', text: t('story.statusAvailable') })
    onClick = () => nav.read(storyId, e.n)
  }

  return button(
    cls,
    [
      h('span', { class: 'episode__num', text: String(e.n) }),
      h('span', { class: 'episode__main' }, [h('span', { class: 'episode__title', text: e.title }), reading ? progressBar(p!.pct) : null]),
      status,
    ],
    onClick,
    {},
    tap,
  )
}
