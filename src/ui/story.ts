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

export function renderStory(root: HTMLElement, storyId: string, nav: Nav): void {
  const story = getStory(storyId)
  if (!story) return nav.toMenu()
  const p = getProgress(storyId)
  const next = nextEpisodeFor(storyId)

  // Главная кнопка
  let cta: HTMLElement
  if (next?.state === 'continue') {
    cta = button('btn btn--primary btn--block btn--lg', [icon('play'), h('span', { text: `Продолжить · ${next.meta.title}` })], () =>
      nav.read(storyId, next.meta.n),
    )
  } else if (next) {
    const label = next.meta.n === 1 && !p?.completed.length ? 'Читать' : `Читать · ${next.meta.title}`
    cta = button('btn btn--primary btn--block btn--lg', [icon('book'), h('span', { text: label })], () => nav.read(storyId, next.meta.n))
  } else {
    const soon = story.episodes.find((e) => e.status === 'soon')
    cta = h('button', { class: 'btn btn--secondary btn--block btn--lg', type: 'button', disabled: '' }, [
      icon('lock'),
      h('span', { text: soon ? `${soon.title} — скоро` : 'Сезон прочитан' }),
    ])
  }

  const screen = h('div', { class: 'screen screen--story' }, [
    h('div', { class: 'topbar' }, [button('icon-btn btn-back', [icon('back')], () => nav.toMenu(), { 'aria-label': 'Назад' })]),
    h('div', { class: 'story-cover', style: `--tint:${story.tint}` }, [
      h('div', { class: 'story-cover__case', text: `Дело № ${story.caseNo}` }),
      h('h1', { class: 'story-cover__title', text: story.title }),
      h('div', { class: 'story-cover__hero', text: story.hero }),
    ]),
    h('div', { class: 'story-body' }, [
      story.description ? h('p', { class: 'story-body__desc', text: story.description }) : null,
      story.tags.length ? h('div', { class: 'tags' }, story.tags.map((t) => h('span', { class: 'tag', text: t }))) : null,
      cta,
      h('div', { class: 'section-head' }, [
        h('span', { class: 'section-head__title', text: 'Сезон 1' }),
        h('span', { class: 'section-head__count', text: `${story.episodes.length} эп.` }),
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
  let cls = 'episode'

  if (!released) {
    cls += ' episode--soon'
    status = h('span', { class: 'episode__status' }, [icon('lock', 'icon icon--sm'), h('span', { text: 'Скоро' })])
    onClick = () => toast(`${e.title} выйдет позже`)
  } else if (reading) {
    cls += ' episode--current'
    status = h('span', { class: 'episode__status episode__status--accent', text: `Читаешь · ${p!.pct}%` })
    onClick = () => nav.read(storyId, e.n)
  } else if (done) {
    cls += ' episode--done'
    status = h('span', { class: 'episode__status episode__status--ok' }, [icon('check', 'icon icon--sm'), h('span', { text: 'Прочитан' })])
    onClick = () =>
      confirmDialog({
        title: `Перечитать ${e.title.toLowerCase()}?`,
        text: 'Выборы этого эпизода сбросятся, прогресс сезона до него сохранится.',
        confirm: 'Перечитать',
        onConfirm: () => nav.read(storyId, e.n, { restart: true }),
      })
  } else {
    status = h('span', { class: 'episode__status', text: 'Доступен' })
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
  )
}
