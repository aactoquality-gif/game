/**
 * server/events-store.mjs без сервера: перезапись журнала на краевых случаях.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rewriteEvents, stripStoredNames, removeStaleTemps } from '../server/events-store.mjs'

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'events-store-'))
  return { dir, file: join(dir, 'events.jsonl'), done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('строки null, числа и массивы считаются битыми и не роняют перезапись', () => {
  const s = scratch()
  try {
    writeFileSync(s.file, ['{"event":"a","user_id":1,"user_name":"Имя"}', 'null', '42', '[1]', '"строка"', '{"event":"b","user_id":2}'].join('\n') + '\n')
    const r = rewriteEvents(s.file, (e) => (e.user_id === 1 ? null : e))
    assert.deepEqual(r, { kept: 1, removed: 1, changed: 0, broken: 4 })
    assert.equal(readFileSync(s.file, 'utf8'), '{"event":"b","user_id":2}\n')
  } finally {
    s.done()
  }
})

test('без изменений файл не перезаписывается', () => {
  const s = scratch()
  try {
    writeFileSync(s.file, '{"event":"a","user_id":1}\n')
    const before = statSync(s.file).mtimeMs
    assert.equal(stripStoredNames(s.file), 0)
    assert.deepEqual(rewriteEvents(s.file, (e) => e), { kept: 1, removed: 0, changed: 0, broken: 0 })
    assert.equal(statSync(s.file).mtimeMs, before)
  } finally {
    s.done()
  }
})

test('нет журнала — пусто, без ошибок', () => {
  const s = scratch()
  try {
    assert.deepEqual(rewriteEvents(s.file, (e) => e), { kept: 0, removed: 0, changed: 0, broken: 0 })
    assert.equal(stripStoredNames(s.file), 0)
    assert.equal(removeStaleTemps(join(s.dir, 'nope', 'events.jsonl')), 0)
  } finally {
    s.done()
  }
})

test('removeStaleTemps удаляет только копии этого журнала', () => {
  const s = scratch()
  try {
    for (const n of ['events.jsonl', 'events.jsonl.tmp-1', 'events.jsonl.tmp-2', 'stats-auth-state.json', 'other.jsonl.tmp-3']) {
      writeFileSync(join(s.dir, n), '')
    }
    assert.equal(removeStaleTemps(s.file), 2)
    assert.deepEqual(readdirSync(s.dir).sort(), ['events.jsonl', 'other.jsonl.tmp-3', 'stats-auth-state.json'])
  } finally {
    s.done()
  }
})
