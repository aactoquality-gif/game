/**
 * Политика конфиденциальности (public/privacy/index.html, адрес /privacy) — публичная страница по ссылке из BotFather.
 * Проверка — сторож: пока вместо почты стоит заглушка, тест красный, чтобы страница не ушла в прод недописанной.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const html = readFileSync(resolve('public/privacy/index.html'), 'utf8')

test('почта для запросов указана — заглушки нет', () => {
  assert.ok(!html.includes('EMAIL_НЕ_УКАЗАН'), 'впиши почту в public/privacy/index.html, раздел 1 (ссылка mailto и текст)')
  const m = /href="mailto:([^"]+)"/.exec(html)
  assert.ok(m, 'нет ссылки mailto')
  assert.match(m[1], /^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'почта в ссылке выглядит неправильно')
})

test('страница описывает то, что делает сервер', () => {
  for (const s of ['Telegram ID', '/deletedata', '/deletedata_confirm', 'потеря доступа к купленному', 'Не храним']) {
    assert.ok(html.includes(s), `в политике нет «${s}»`)
  }
})
